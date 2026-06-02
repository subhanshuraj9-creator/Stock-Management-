import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, cleanUndefined } from '../firebase';
import { collection, onSnapshot, addDoc, query, orderBy, runTransaction, doc, writeBatch } from 'firebase/firestore';
import { Job, StockItem, JobItem } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Plus, Search, FileText, Calendar, User, ChevronRight, Edit2, Trash2, Truck, Inbox, CheckCircle2, PackageCheck, Download, Eye, Image as ImageIcon, Printer } from 'lucide-react';
import { Badge } from './ui/badge';
import { InvoiceModal } from './InvoiceModal';
import { JobPreviewModal } from './JobPreviewModal';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface StockSelectProps {
  value: string;
  onValueChange: (v: string) => void;
  stocks: StockItem[];
  type: 'paper' | 'plate';
  placeholder: string;
  disabled?: boolean;
}

const StockSelect = ({ 
  value, 
  onValueChange, 
  stocks, 
  type, 
  placeholder,
  disabled
}: StockSelectProps) => {
  const [search, setSearch] = useState('');
  
  const filtered = stocks.filter(s => {
    if (s.id === value) return true;
    
    const matchesType = type === 'paper' 
      ? (s.type === 'paper' || s.type === 'board')
      : s.type === 'plate';
      
    if (!matchesType) return false;
    
    const term = search.toLowerCase();
    return s.name.toLowerCase().includes(term) || 
           (s.size && s.size.toLowerCase().includes(term)) ||
           (s.gsm && s.gsm.toString().includes(term));
  });

  const selectedStock = stocks.find(s => s.id === value);
  const displayLabel = selectedStock 
    ? `${selectedStock.name} ${type === 'paper' ? `(${selectedStock.gsm ? `${selectedStock.gsm} GSM, ` : ''}${selectedStock.size || ''})` : (selectedStock.size ? `(${selectedStock.size})` : '')}`
    : '';

  return (
    <Select 
      value={value} 
      onValueChange={onValueChange}
      onOpenChange={(open) => { if (open) setSearch(''); }}
      disabled={disabled}
    >
      <SelectTrigger className="bg-white">
        <SelectValue placeholder={placeholder}>
          {value ? displayLabel : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <div className="p-2 sticky top-0 bg-popover z-10 border-b border-gray-100">
          <Input 
            placeholder={`Search ${type}...`} 
            value={search} 
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            className="h-9 text-sm"
          />
        </div>
        <SelectGroup>
          {filtered.map(s => {
            const itemLabel = `${s.name} ${type === 'paper' ? `(${s.gsm ? `${s.gsm} GSM, ` : ''}${s.size || ''})` : (s.size ? `(${s.size})` : '')}`;
            return (
              <SelectItem key={s.id} value={s.id}>
                <div className="flex justify-between items-center w-full gap-2 overflow-hidden">
                  <span className="truncate">{itemLabel}</span>
                  <span className="text-[10px] font-medium bg-gray-100 px-1.5 py-0.5 rounded-full shrink-0 [[data-slot=select-value]_&]:hidden">
                    {s.quantity} left
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

const getInitialProcessCharges = () => [
  { id: 'printing', name: 'Printing', amount: 0, notes: '' },
  { id: 'cutting', name: 'Cutting', amount: 0, notes: '' },
  { id: 'folding', name: 'Folding', amount: 0, notes: '' },
  { id: 'binding', name: 'Binding', amount: 0, notes: '' }
];

const loadProcessChargesForEditing = (job: Job) => {
  const standardList = getInitialProcessCharges();
  const jobList = job.processCharges || [];
  
  const merged = standardList.map(item => {
    const found = jobList.find(j => j.id === item.id || j.name.toLowerCase() === item.name.toLowerCase());
    return found ? { ...item, amount: found.amount, notes: found.notes || '' } : item;
  });

  const customList = jobList.filter(j => 
    !standardList.some(s => s.id === j.id || s.name.toLowerCase() === j.name.toLowerCase())
  ).map(j => ({ id: j.id, name: j.name, amount: j.amount, notes: j.notes || '' }));

  return [...merged, ...customList];
};

export function JobManagement() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [invoiceJob, setInvoiceJob] = useState<Job | null>(null);
  const [previewJob, setPreviewJob] = useState<Job | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Dispatch tracking states
  const [selectedJobForDispatch, setSelectedJobForDispatch] = useState<Job | null>(null);
  const [isDispatchDialogOpen, setIsDispatchDialogOpen] = useState(false);
  const [dispatchFormData, setDispatchFormData] = useState({
    quantityShipped: '',
    receiverName: '',
    notes: ''
  });

  const handleClearJobs = async () => {
    setIsClearing(true);
    try {
      const batch = writeBatch(db);
      jobs.forEach(job => {
        batch.delete(doc(db, 'jobs', job.id));
      });
      await batch.commit();
      toast.success('All job orders removed from history');
      setIsClearConfirmOpen(false);
    } catch (error) {
      console.error(error);
      toast.error('Failed to clear jobs history');
    } finally {
      setIsClearing(false);
    }
  };

  const [formData, setFormData] = useState({
    clientName: '',
    jobDescription: '',
    selectedItems: [] as JobItem[],
    platesUsed: [] as { plateId: string; count: number; isJoint?: boolean; plateRef?: string; rate?: number; }[],
    processCharges: getInitialProcessCharges(),
    ignoreStockLimits: false,
    orderedQuantity: '' as string | number,
    isJoint: false,
    jointRef: ''
  });

  useEffect(() => {
    const jobsQ = query(collection(db, 'jobs'), orderBy('date', 'desc'));
    const unsubscribeJobs = onSnapshot(jobsQ, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
      setJobs(items);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'jobs');
    });

    const stocksQ = query(collection(db, 'stocks'));
    const unsubscribeStocks = onSnapshot(stocksQ, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockItem));
      setStocks(items);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'stocks');
    });

    return () => {
      unsubscribeJobs();
      unsubscribeStocks();
    };
  }, []);

  const handleAddItem = () => {
    const isJoint = !!(formData as any).isJoint;
    const jointRef = (formData as any).jointRef || '';
    setFormData({
      ...formData,
      selectedItems: [
        ...formData.selectedItems, 
        { 
          stockId: '', 
          quantityUsed: 0, 
          rate: 0,
          ups: undefined,
          autoCalculate: true,
          calculatedSheets: 0,
          isJoint: isJoint,
          paperRef: jointRef
        }
      ]
    });
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...formData.selectedItems];
    newItems.splice(index, 1);
    setFormData({ ...formData, selectedItems: newItems });
  };

  const handleOrderedQuantityChange = (val: string) => {
    const ordered = Number(val) || 0;
    const updatedItems = formData.selectedItems.map(item => {
      const upsVal = Number(item.ups) || 1;
      const calculated = upsVal > 0 ? Math.ceil(ordered / upsVal) : 0;
      
      const updatedItem = {
        ...item,
        calculatedSheets: calculated
      };
      
      // Only overwrite the actual physical quantityUsed if auto-calculate is on AND it is NOT a joint paper run
      if (item.autoCalculate && !item.isJoint) {
        updatedItem.quantityUsed = calculated;
      }
      return updatedItem;
    });
    setFormData({ ...formData, orderedQuantity: val, selectedItems: updatedItems });
  };

  const applyJointRefAndAutoDetect = (refCode: string, items = formData.selectedItems, plates = formData.platesUsed) => {
    const cleanRef = refCode.trim().toUpperCase().replace('#', '');
    const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
    
    // For joint jobs, we always want exactly one paper item in selectedItems
    let updatedItems = [...items];
    if (updatedItems.length === 0) {
      updatedItems = [{
        stockId: '',
        rate: 0,
        quantityUsed: 0,
        calculatedSheets: 0,
        isJoint: true,
        paperRef: refCode
      }];
    }
    
    updatedItems = updatedItems.map((item, idx) => {
      const updatedItem = {
        ...item,
        isJoint: true,
        paperRef: refCode
      };
      
      if (matchingJob && idx === 0) {
        const matchingItem = matchingJob.items?.[0];
        if (matchingItem) {
          updatedItem.stockId = matchingItem.stockId || '';
          updatedItem.rate = matchingItem.rate || 0;
          updatedItem.ups = matchingItem.ups;
          updatedItem.quantityUsed = matchingItem.quantityUsed || 0;
          updatedItem.calculatedSheets = matchingItem.calculatedSheets || 0;
        }
      }
      return updatedItem;
    });

    // For joint jobs, automatically detect and synchronize ALL plates from the referenced job.
    // Since plates are not editable manually for joint jobs, we copy them directly from the joint reference.
    let updatedPlates: any[] = [];
    if (matchingJob && matchingJob.platesUsed && matchingJob.platesUsed.length > 0) {
      updatedPlates = matchingJob.platesUsed.map((p, idx) => {
        const existingPlate = plates?.[idx];
        const stockDefault = stocks.find(s => s.id === p.plateId)?.defaultRate || 0;
        const rateToUse = (existingPlate && existingPlate.plateId === p.plateId && existingPlate.rate !== undefined && existingPlate.rate > 0) 
          ? existingPlate.rate 
          : (p.rate || stockDefault);

        return {
          ...p,
          rate: rateToUse,
          isJoint: true,
          plateRef: refCode
        };
      });
    }

    setFormData({
      ...formData,
      isJoint: true,
      jointRef: refCode,
      selectedItems: updatedItems,
      platesUsed: updatedPlates
    } as any);

    if (matchingJob && cleanRef.length === 4) {
      const matchedPaperStock = stocks.find(s => s.id === matchingJob.items?.[0]?.stockId);
      const stockMsg = matchedPaperStock ? ` (Stock: ${matchedPaperStock.name})` : '';
      toast.success(`Connected to Job #${cleanRef}${stockMsg}. Material & Plate stocks synchronized!`);
    }
  };

  const handleJointJobToggle = (isJoint: boolean) => {
    const refValue = isJoint ? (formData as any).jointRef || '' : '';
    
    if (isJoint) {
      const cleanRef = refValue.trim().toUpperCase().replace('#', '');
      const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
      const firstItem = formData.selectedItems[0];
      
      const updatedItems = [{
        stockId: matchingJob?.items?.[0]?.stockId || firstItem?.stockId || '',
        rate: matchingJob?.items?.[0]?.rate || firstItem?.rate || 0,
        quantityUsed: matchingJob?.items?.[0]?.quantityUsed || firstItem?.quantityUsed || 0,
        calculatedSheets: matchingJob?.items?.[0]?.calculatedSheets || firstItem?.calculatedSheets || 0,
        ups: matchingJob?.items?.[0]?.ups || firstItem?.ups,
        isJoint: true,
        paperRef: refValue
      }];

      let updatedPlates: any[] = [];
      if (matchingJob && matchingJob.platesUsed && matchingJob.platesUsed.length > 0) {
        updatedPlates = matchingJob.platesUsed.map((p, idx) => {
          const existingPlate = formData.platesUsed?.[idx];
          const stockDefault = stocks.find(s => s.id === p.plateId)?.defaultRate || 0;
          const rateToUse = (existingPlate && existingPlate.plateId === p.plateId && existingPlate.rate !== undefined && existingPlate.rate > 0) 
            ? existingPlate.rate 
            : (p.rate || stockDefault);

          return {
            ...p,
            rate: rateToUse,
            isJoint: true,
            plateRef: refValue
          };
        });
      }

      setFormData({
        ...formData,
        isJoint: true,
        jointRef: refValue,
        selectedItems: updatedItems,
        platesUsed: updatedPlates
      } as any);
      
      if (refValue) {
        applyJointRefAndAutoDetect(refValue, updatedItems, updatedPlates);
      }
    } else {
      // Revert to normal job
      const updatedItems = formData.selectedItems.map(item => ({
        ...item,
        isJoint: false,
        paperRef: ''
      }));
      setFormData({
        ...formData,
        isJoint: false,
        jointRef: '',
        selectedItems: updatedItems,
        platesUsed: []
      } as any);
    }
  };

  const handleJointJobRefChange = (val: string) => {
    applyJointRefAndAutoDetect(val);
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...formData.selectedItems];
    let update: any = { [field]: value };
    
    if (field === 'stockId' && value) {
      const selectedStock = stocks.find(s => s.id === value);
      if (selectedStock) {
        update.rate = selectedStock.defaultRate || 0;
      }
    }
    
    const mergedItem = { ...newItems[index], ...update };
    
    // Always calculate sheets required for individual jobs based on their orderedQuantity and ups
    const ordered = Number(formData.orderedQuantity) || 0;
    const upsVal = Number(mergedItem.ups) || 1;
    const calculated = upsVal > 0 ? Math.ceil(ordered / upsVal) : 0;
    mergedItem.calculatedSheets = calculated;
    
    // Physical sheet consumption is only equal to calculated requirement if not joint paper
    if (mergedItem.autoCalculate && !mergedItem.isJoint) {
      if (field === 'ups' || field === 'autoCalculate' || mergedItem.quantityUsed === 0) {
        mergedItem.quantityUsed = calculated;
      }
    }

    // Auto-detect matching paper stock actual usage if this is a joint job and stock selection changes
    if ((formData as any).isJoint && (formData as any).jointRef && field === 'stockId' && value) {
      const cleanRef = (formData as any).jointRef.trim().toUpperCase().replace('#', '');
      const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
      if (matchingJob) {
        const matchingItem = matchingJob.items?.find((it: any) => it.stockId === value);
        if (matchingItem) {
          mergedItem.quantityUsed = matchingItem.quantityUsed;
          const stockName = stocks.find(s => s.id === value)?.name || 'paper';
          toast.success(`Auto-detected ${matchingItem.quantityUsed} physical sheets of ${stockName} from Job #${cleanRef}`);
        }
      }
    }
    
    newItems[index] = mergedItem;
    setFormData({ ...formData, selectedItems: newItems });
  };

  const handleAddPlate = () => {
    setFormData({
      ...formData,
      platesUsed: [...formData.platesUsed, { plateId: '', count: 0, isJoint: false, plateRef: '', rate: 0 }]
    });
  };

  const handleRemovePlate = (index: number) => {
    const newPlates = [...formData.platesUsed];
    newPlates.splice(index, 1);
    setFormData({ ...formData, platesUsed: newPlates });
  };

  const handlePlateChange = (index: number, field: 'plateId' | 'count' | 'isJoint' | 'plateRef' | 'rate', value: any) => {
    const newPlates = [...formData.platesUsed];
    let rateUpdate = {};
    if (field === 'plateId' && value) {
      const selectedStock = stocks.find(s => s.id === value);
      if (selectedStock) {
        rateUpdate = { rate: selectedStock.defaultRate || 0 };
      }
    }
    newPlates[index] = { ...newPlates[index], [field]: value, ...rateUpdate };

    // Auto-detect matching plate actual count if this is a joint job and plate selection changes
    if ((formData as any).isJoint && (formData as any).jointRef && field === 'plateId' && value) {
      const cleanRef = (formData as any).jointRef.trim().toUpperCase().replace('#', '');
      const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
      if (matchingJob) {
        const matchingPlate = matchingJob.platesUsed?.find((pl: any) => pl.plateId === value);
        if (matchingPlate) {
          newPlates[index].count = matchingPlate.count;
          const stockName = stocks.find(s => s.id === value)?.name || 'plate';
          toast.success(`Auto-detected ${matchingPlate.count} plates of ${stockName} from Job #${cleanRef}`);
        }
      }
    }

    setFormData({ 
      ...formData, 
      platesUsed: newPlates
    });
  };

  const handleAddCustomProcessCharge = () => {
    const customId = `custom-${Date.now()}`;
    setFormData({
      ...formData,
      processCharges: [...formData.processCharges, { id: customId, name: '', amount: 0, notes: '' }]
    });
  };

  const handleRemoveProcessCharge = (id: string) => {
    const standardIds = ['printing', 'cutting', 'folding', 'binding'];
    if (standardIds.includes(id)) {
      setFormData({
        ...formData,
        processCharges: formData.processCharges.map(pc => pc.id === id ? { ...pc, amount: 0, notes: '' } : pc)
      });
    } else {
      setFormData({
        ...formData,
        processCharges: formData.processCharges.filter(pc => pc.id !== id)
      });
    }
  };

  const handleProcessChargeChange = (id: string, field: 'name' | 'amount' | 'notes', value: any) => {
    setFormData({
      ...formData,
      processCharges: formData.processCharges.map(pc => pc.id === id ? { ...pc, [field]: value } : pc)
    });
  };

  const handleAddJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.selectedItems.length === 0 && formData.platesUsed.length === 0 && !formData.processCharges.some(pc => pc.amount > 0)) {
      toast.error('Please add at least one material stock, plate, or process charge to the job');
      return;
    }

    if (formData.isJoint && formData.selectedItems.length === 0) {
      toast.error('For joint jobs, specifying the paper required is compulsory');
      return;
    }

    for (const item of formData.selectedItems) {
      if (!item.stockId) {
        toast.error('Please select a paper stock for all items');
        return;
      }
    }

    try {
      await runTransaction(db, async (transaction) => {
        // 1. Check if all stocks have enough quantity (exclude joint plates and joint papers from stock check)
        const allItems = [
          ...formData.selectedItems.filter(i => !i.isJoint).map(i => ({ id: i.stockId, used: i.quantityUsed })),
          ...formData.platesUsed.filter(p => !p.isJoint).map(p => ({ id: p.plateId, used: p.count }))
        ].filter(i => i.id);

        const stockRefs = allItems.map(item => doc(db, 'stocks', item.id));
        const stockSnaps = await Promise.all(stockRefs.map(ref => transaction.get(ref)));

        for (let i = 0; i < stockSnaps.length; i++) {
          const snap = stockSnaps[i];
          const item = allItems[i];
          if (!snap.exists()) throw new Error(`Stock ${item.id} not found`);
          const stockData = snap.data() as StockItem;
          if (stockData.quantity < item.used && !formData.ignoreStockLimits) {
            throw new Error(`Insufficient stock for ${stockData.name}. Available: ${stockData.quantity}`);
          }
        }

        // 2. Deduct stock and record history (excluding joint plates and shared print runs)
        stockSnaps.forEach((snap, i) => {
          const item = allItems[i];
          const stockData = snap.data() as StockItem;
          const newQuantity = stockData.quantity - item.used;
          
          transaction.update(snap.ref, {
            quantity: newQuantity,
            lastUpdated: Date.now()
          });

          const historyRef = doc(collection(db, 'stockHistory'));
          transaction.set(historyRef, {
            stockId: item.id,
            date: Date.now(),
            type: 'usage',
            quantity: -item.used,
            previousQuantity: stockData.quantity,
            newQuantity: newQuantity,
            notes: `Job created (individual stock deducted): ${formData.clientName} - ${formData.jobDescription}`
          });
        });

        // 3. Create job (including joint status, custom rates & process charges breakdown)
        const jobData = {
          clientName: formData.clientName,
          jobDescription: formData.jobDescription,
          date: Date.now(),
          items: formData.selectedItems,
          platesUsed: formData.platesUsed,
          processCharges: formData.processCharges.filter(pc => pc.amount > 0 || (pc.notes && pc.notes.trim() !== '')),
          orderedQuantity: formData.orderedQuantity ? Number(formData.orderedQuantity) : 0,
          dispatches: [],
          dispatchStatus: 'pending' as const,
          isJoint: !!(formData as any).isJoint,
          jointRef: (formData as any).jointRef || ''
        };
        const jobsRef = collection(db, 'jobs');
        const newJobDoc = doc(jobsRef);
        transaction.set(newJobDoc, cleanUndefined(jobData));
      });

      setIsAddOpen(false);
      setFormData({ clientName: '', jobDescription: '', selectedItems: [], platesUsed: [], processCharges: getInitialProcessCharges(), ignoreStockLimits: false, orderedQuantity: '', isJoint: false, jointRef: '' } as any);
      toast.success('Job created and stock updated successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create job');
      console.error(error);
    }
  };

  const handleDeleteJob = async () => {
    if (!jobToDelete) return;
    
    try {
      await runTransaction(db, async (transaction) => {
        // 1. Return stock (only return plates and paper that were actually deducted - excluding joint plates and joint papers!)
        const allItems = [
          ...jobToDelete.items.filter(i => !i.isJoint).map(i => ({ id: i.stockId, used: i.quantityUsed })),
          ...(jobToDelete.platesUsed || []).filter(p => !p.isJoint).map(p => ({ id: p.plateId, used: p.count }))
        ].filter(item => item.id);

        // Fetch all stock snapshots in parallel before any writes
        const stockRefs = allItems.map(item => doc(db, 'stocks', item.id));
        const stockSnaps = stockRefs.length > 0 
          ? await Promise.all(stockRefs.map(ref => transaction.get(ref)))
          : [];
        
        // 2. We now have all snaps retrieved before any updates. Perform updates and create history.
        stockSnaps.forEach((snap, idx) => {
          const item = allItems[idx];
          if (snap.exists()) {
            const stockData = snap.data() as StockItem;
            const newQuantity = stockData.quantity + item.used;
            transaction.update(snap.ref, {
              quantity: newQuantity,
              lastUpdated: Date.now()
            });

            const historyRef = doc(collection(db, 'stockHistory'));
            transaction.set(historyRef, {
              stockId: item.id,
              date: Date.now(),
              type: 'addition',
              quantity: item.used,
              previousQuantity: stockData.quantity,
              newQuantity: newQuantity,
              notes: `Job deleted: ${jobToDelete.clientName} - ${jobToDelete.jobDescription}`
            });
          }
        });
        
        // 3. Delete job
        transaction.delete(doc(db, 'jobs', jobToDelete.id));
      });
      setJobToDelete(null);
      toast.success('Job deleted and stock returned successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `jobs/${jobToDelete.id}`);
    }
  };

  const handleDownloadDispatchHistory = (job: Job) => {
    const dispatches = job.dispatches || [];
    if (dispatches.length === 0) {
      toast.error("No dispatches to download for this job order.");
      return;
    }

    // Sort dispatches chronologically (earliest to latest)
    const sortedDispatches = [...dispatches].sort((a, b) => a.date - b.date);

    // Dynamic math
    const totalOrdered = job.orderedQuantity || 0;
    const totalDispatched = dispatches.reduce((sum, d) => sum + d.quantityShipped, 0);
    const balanceRemaining = totalOrdered > 0 ? Math.max(0, totalOrdered - totalDispatched) : 0;
    const percentDispatched = totalOrdered > 0 ? Math.round((totalDispatched / totalOrdered) * 100) : 0;

    // Build Job Details / Metadata Rows
    const metadataRows: string[][] = [
      ["JOB ORDER SUMMARY REPORT"],
      ["Client Name", job.clientName || ""],
      ["Job Description", job.jobDescription || ""],
      ["Job Creation Date", format(job.date, 'yyyy-MM-dd HH:mm')],
      ["Job Order Status", job.dispatchStatus ? job.dispatchStatus.toUpperCase() : "PENDING"],
      [],
      ["QUANTITY SUMMARY"],
      ["Total Ordered Quantity", totalOrdered > 0 ? `${totalOrdered} units` : "N/A"],
      ["Total Dispatched Quantity", `${totalDispatched} units (${percentDispatched}%)`],
      ["Balance Remaining", totalOrdered > 0 ? `${balanceRemaining} units` : "N/A"],
      [],
      ["BILLING & RAW MATERIALS USED"]
    ];

    // Build raw materials consumed summary from job items list
    const materialsUsed: string[] = [];
    if (job.items && job.items.length > 0) {
      job.items.forEach(item => {
        const stockItem = stocks.find(s => s.id === item.stockId);
        if (stockItem) {
          const unitLabel = stockItem.type === 'ink' ? 'kg' : stockItem.type === 'plate' ? 'units' : 'sheets';
          materialsUsed.push(`${stockItem.name}: ${item.quantityUsed.toLocaleString()} ${unitLabel}`);
        }
      });
    }
    if (materialsUsed.length > 0) {
      metadataRows.push(["Stock Items Consumed", materialsUsed.join(" | ")]);
    } else {
      metadataRows.push(["Stock Items Consumed", "None recorded"]);
    }

    // Offset Plates details
    const platesUsedText: string[] = [];
    const resolvedPlatesExport = [...(job.platesUsed || [])];
    if (job.isJoint && job.jointRef && jobs && jobs.length > 0) {
      const cleanRef = job.jointRef.trim().toUpperCase().replace('#', '');
      const referencedJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
      if (referencedJob && referencedJob.platesUsed) {
        referencedJob.platesUsed.forEach(refPlate => {
          const isDuplicate = resolvedPlatesExport.some(p => p.plateId === refPlate.plateId);
          if (!isDuplicate) {
            resolvedPlatesExport.push({
              ...refPlate,
              isJoint: true,
              plateRef: cleanRef
            } as any);
          }
        });
      }
    }
    const validPlatesExport = resolvedPlatesExport.filter(p => p.plateId);
    if (validPlatesExport.length > 0) {
      validPlatesExport.forEach(p => {
        const plateStock = stocks.find(s => s.id === p.plateId);
        if (plateStock) {
          let text = `${plateStock.name} (${p.count} units)`;
          if (p.isJoint) {
            text += ` [Joint Plate: ${p.plateRef || 'Yes'}]`;
          }
          platesUsedText.push(text);
        }
      });
    }
    if (platesUsedText.length > 0) {
      metadataRows.push(["Offset Plates Used", platesUsedText.join(" | ")]);
    }

    // Process & finishing charges
    const processChargesText: string[] = [];
    if (job.processCharges && job.processCharges.length > 0) {
      const activeCharges = job.processCharges.filter(pc => pc.amount > 0);
      activeCharges.forEach(pc => {
        let text = `${pc.name} (Rs ${pc.amount})`;
        if (pc.notes) text += ` [${pc.notes}]`;
        processChargesText.push(text);
      });
    }
    if (processChargesText.length > 0) {
      metadataRows.push(["Process & Finishing Charges", processChargesText.join(" | ")]);
    }

    metadataRows.push([]); // blank divider line
    metadataRows.push(["DISPATCH DELIVERY LOGS"]); // header block of shipment logs section

    // Dispatch Logs table headers
    const logHeaders = [
      "Sr No", 
      "Date", 
      "Time", 
      "Shipped/Delivered Qty", 
      "Received/Collected By", 
      "Tracking Notes/Gatepass Referrals"
    ];
    metadataRows.push(logHeaders);

    // Convert log items to rows
    sortedDispatches.forEach((disp, idx) => {
      const formattedDate = format(disp.date, 'yyyy-MM-dd');
      const formattedTime = format(disp.date, 'HH:mm:ss');
      const cleanReceiver = (disp.receiverName || '').replace(/"/g, '""');
      const cleanNotes = (disp.notes || '').replace(/"/g, '""');

      metadataRows.push([
        String(idx + 1),
        formattedDate,
        formattedTime,
        String(disp.quantityShipped),
        cleanReceiver,
        cleanNotes
      ]);
    });

    // Helper: safely wrap each cell value in double quotes and escape internal quotes to ensure CSV format stability
    const csvContent = metadataRows.map(row => {
      return row.map(cell => {
        let val = String(cell);
        // Replace absolute quotes/returns
        val = val.replace(/"/g, '""');
        return `"${val}"`;
      }).join(",");
    }).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // Create direct anchor click to trigger downloading prompt
    const link = document.createElement("a");
    link.href = url;
    const safeClientName = (job.clientName || 'job').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `detailed_dispatch_report_${safeClientName}_${format(new Date(), 'yyyyMMdd')}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('Successfully downloaded detailed dispatch & job report as CSV!');
  };

  const handleRecordDispatch = async (e: React.FormEvent, forceFullDispatchQuantity?: number) => {
    e.preventDefault();
    if (!selectedJobForDispatch) return;

    const qty = forceFullDispatchQuantity !== undefined 
      ? forceFullDispatchQuantity 
      : Number(dispatchFormData.quantityShipped);

    if (isNaN(qty) || qty <= 0) {
      toast.error('Please enter a valid dispatch quantity');
      return;
    }

    try {
      const jobRef = doc(db, 'jobs', selectedJobForDispatch.id);
      await runTransaction(db, async (transaction) => {
        const jobSnap = await transaction.get(jobRef);
        if (!jobSnap.exists()) throw new Error('Job document does not exist anymore');

        const jobData = jobSnap.data() as Job;
        const currentDispatches = jobData.dispatches ? [...jobData.dispatches] : [];

        const newRecord = {
          id: `disp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          date: Date.now(),
          quantityShipped: qty,
          receiverName: forceFullDispatchQuantity !== undefined ? 'System Auto-dispatch' : (dispatchFormData.receiverName.trim() || undefined),
          notes: forceFullDispatchQuantity !== undefined ? 'Marked complete manually' : (dispatchFormData.notes.trim() || undefined)
        };

        currentDispatches.push(newRecord);

        // Calculate dispatch status
        let status: 'pending' | 'partial' | 'completed' = 'pending';
        if (jobData.orderedQuantity && jobData.orderedQuantity > 0) {
          const totalDispatched = currentDispatches.reduce((sum, d) => sum + d.quantityShipped, 0);
          if (totalDispatched >= jobData.orderedQuantity) {
            status = 'completed';
          } else if (totalDispatched > 0) {
            status = 'partial';
          }
        } else {
          status = 'completed'; 
        }

        transaction.update(jobRef, {
          dispatches: currentDispatches,
          dispatchStatus: status
        });
      });

      toast.success('Dispatch shipment successfully recorded');
      setDispatchFormData({ quantityShipped: '', receiverName: '', notes: '' });
    } catch (error: any) {
      toast.error(error.message || 'Failed to record dispatch');
    }
  };

  const handleDeleteDispatch = async (dispatchId: string) => {
    if (!selectedJobForDispatch) return;

    try {
      const jobRef = doc(db, 'jobs', selectedJobForDispatch.id);
      await runTransaction(db, async (transaction) => {
        const jobSnap = await transaction.get(jobRef);
        if (!jobSnap.exists()) throw new Error('Job document does not exist anymore');

        const jobData = jobSnap.data() as Job;
        const currentDispatches = jobData.dispatches ? jobData.dispatches.filter(d => d.id !== dispatchId) : [];

        // Calculate dispatch status
        let status: 'pending' | 'partial' | 'completed' = 'pending';
        if (jobData.orderedQuantity && jobData.orderedQuantity > 0) {
          const totalDispatched = currentDispatches.reduce((sum, d) => sum + d.quantityShipped, 0);
          if (totalDispatched >= jobData.orderedQuantity) {
            status = 'completed';
          } else if (totalDispatched > 0) {
            status = 'partial';
          }
        } else {
          status = currentDispatches.length > 0 ? 'partial' : 'pending';
        }

        transaction.update(jobRef, {
          dispatches: currentDispatches,
          dispatchStatus: status
        });
      });

      toast.success('Dispatch log record deleted successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete dispatch shipment record');
    }
  };

  const handleUpdateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingJob) return;
    if (formData.selectedItems.length === 0 && formData.platesUsed.length === 0 && !formData.processCharges.some(pc => pc.amount > 0)) {
      toast.error('Please add at least one material stock, plate, or process charge to the job');
      return;
    }

    if (formData.isJoint && formData.selectedItems.length === 0) {
      toast.error('For joint jobs, specifying the paper required is compulsory');
      return;
    }

    for (const item of formData.selectedItems) {
      if (!item.stockId) {
        toast.error('Please select a paper stock for all items');
        return;
      }
    }

    try {
      await runTransaction(db, async (transaction) => {
        const oldItems = [
          ...editingJob.items.filter(i => !i.isJoint).map(i => ({ id: i.stockId, used: i.quantityUsed })),
          ...(editingJob.platesUsed || []).filter(p => !p.isJoint).map(p => ({ id: p.plateId, used: p.count }))
        ];
        const newItems = [
          ...formData.selectedItems.filter(i => !i.isJoint).map(i => ({ id: i.stockId, used: i.quantityUsed })),
          ...formData.platesUsed.filter(p => !p.isJoint).map(p => ({ id: p.plateId, used: p.count }))
        ];

        const allStockIds = Array.from(new Set([
          ...oldItems.map(i => i.id),
          ...newItems.map(i => i.id)
        ])).filter(id => id);
        
        const stockSnaps = await Promise.all(allStockIds.map(id => transaction.get(doc(db, 'stocks', id))));
        const stockDataMap = new Map(stockSnaps.map(s => [s.id, s.data() as StockItem]));

        // Validate and calculate new quantities
        for (const id of allStockIds) {
          const stock = stockDataMap.get(id);
          if (!stock) continue;
          
          const oldUsage = oldItems.filter(i => i.id === id).reduce((sum, i) => sum + i.used, 0);
          const newUsage = newItems.filter(i => i.id === id).reduce((sum, i) => sum + i.used, 0);
          
          const netChange = oldUsage - newUsage;
          const finalQuantity = stock.quantity + netChange;
          
          if (finalQuantity < 0 && !formData.ignoreStockLimits) {
            throw new Error(`Insufficient stock for ${stock.name}. Available: ${stock.quantity + oldUsage}`);
          }
          
          transaction.update(doc(db, 'stocks', id), {
            quantity: finalQuantity,
            lastUpdated: Date.now()
          });

          if (netChange !== 0) {
            const historyRef = doc(collection(db, 'stockHistory'));
            transaction.set(historyRef, {
              stockId: id,
              date: Date.now(),
              type: netChange > 0 ? 'addition' : 'usage',
              quantity: netChange,
              previousQuantity: stock.quantity,
              newQuantity: finalQuantity,
              notes: `Job updated: ${formData.clientName} - ${formData.jobDescription}`
            });
          }
        }

        const updatedDispatches = editingJob.dispatches || [];
        const orderedQty = formData.orderedQuantity ? Number(formData.orderedQuantity) : 0;
        let status: 'pending' | 'partial' | 'completed' = 'pending';
        if (orderedQty > 0) {
          const totalShipped = updatedDispatches.reduce((sum, d) => sum + d.quantityShipped, 0);
          if (totalShipped >= orderedQty) {
            status = 'completed';
          } else if (totalShipped > 0) {
            status = 'partial';
          }
        } else {
          status = updatedDispatches.length > 0 ? 'partial' : 'pending';
        }

        const updateFields = {
          clientName: formData.clientName,
          jobDescription: formData.jobDescription,
          items: formData.selectedItems,
          platesUsed: formData.platesUsed,
          processCharges: formData.processCharges.filter(pc => pc.amount > 0 || (pc.notes && pc.notes.trim() !== '')),
          orderedQuantity: orderedQty,
          dispatchStatus: status,
          isJoint: !!(formData as any).isJoint,
          jointRef: (formData as any).jointRef || ''
        };

        transaction.update(doc(db, 'jobs', editingJob.id), cleanUndefined(updateFields) as any);
      });

      setEditingJob(null);
      setFormData({ clientName: '', jobDescription: '', selectedItems: [], platesUsed: [], processCharges: getInitialProcessCharges(), ignoreStockLimits: false, orderedQuantity: '', isJoint: false, jointRef: '' } as any);
      toast.success('Job updated successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update job');
    }
  };

  const filteredJobs = jobs.filter(job => 
    job.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    job.jobDescription.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-serif font-medium text-gray-900">Printing Jobs</h2>
          <p className="text-sm md:text-base text-gray-500 font-serif italic">Track and manage client orders</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          {jobs.length > 0 && (
            <Button
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50 rounded-full h-12 md:h-10 px-4 flex items-center justify-center gap-2 w-full sm:w-auto shrink-0"
              onClick={() => setIsClearConfirmOpen(true)}
            >
              <Trash2 size={16} />
              <span>Clear Jobs History</span>
            </Button>
          )}
          <Dialog open={isAddOpen} onOpenChange={(open) => {
          setIsAddOpen(open);
          if (open) {
            setFormData({
              clientName: '',
              jobDescription: '',
              selectedItems: [],
              platesUsed: [],
              processCharges: getInitialProcessCharges(),
              ignoreStockLimits: false,
              orderedQuantity: '',
              isJoint: false,
              jointRef: ''
            } as any);
          }
        }}>
          <DialogTrigger render={<Button className="bg-[#5A5A40] hover:bg-[#4A4A30] rounded-full px-6 w-full sm:w-auto h-12 md:h-10" />}>
            <Plus className="mr-2 h-4 w-4" /> Create New Job
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Job</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddJob} className="space-y-6 py-4">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50/50 rounded-2xl border border-gray-100 shadow-xs">
                  <div className="space-y-2">
                    <Label htmlFor="clientName" className="flex items-center gap-1 text-sm font-semibold text-gray-700">
                      <span>Client Name</span>
                      <span className="text-red-500 font-bold">*</span>
                    </Label>
                    <Input id="clientName" value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})} required className="bg-white border-gray-200" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jobDescription" className="flex items-center gap-1 text-sm font-semibold text-gray-700">
                      <span>Job Description</span>
                      <span className="text-red-500 font-bold">*</span>
                    </Label>
                    <Input id="jobDescription" value={formData.jobDescription} onChange={e => setFormData({...formData, jobDescription: e.target.value})} required className="bg-white border-gray-200" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orderedQuantity" className="flex items-center gap-1">
                    <span>Ordered Finished Product Quantity</span>
                    <span className="text-red-500 font-bold">*</span>
                  </Label>
                  <Input 
                    id="orderedQuantity" 
                    type="number" 
                    placeholder="e.g. 10000" 
                    value={formData.orderedQuantity} 
                    onChange={e => handleOrderedQuantityChange(e.target.value)} 
                    required
                  />
                </div>
                <div className="flex flex-col md:flex-row gap-4 p-4 bg-amber-50/50 rounded-2xl border border-amber-100/70 mt-3 space-y-3 md:space-y-0">
                  <div className="flex items-center gap-2">
                    <input 
                      id="isJointJob"
                      type="checkbox" 
                      checked={!!(formData as any).isJoint} 
                      onChange={e => handleJointJobToggle(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-0 cursor-pointer"
                    />
                    <Label htmlFor="isJointJob" className="text-sm text-amber-800 font-bold cursor-pointer select-none">This is a Joint Job</Label>
                  </div>
                  {!!(formData as any).isJoint && (
                    <div className="flex-1 space-y-1">
                      <Label className="text-[10px] font-bold text-gray-500 uppercase">Shared Joint Job Reference Code</Label>
                      <Input 
                        type="text" 
                        placeholder="Job Code to share paper & plates with (e.g. A3B8)" 
                        list="active-jobs-list"
                        value={(formData as any).jointRef || ''} 
                        onChange={e => handleJointJobRefChange(e.target.value)}
                        className="bg-white h-9 text-xs rounded-lg font-mono uppercase"
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 py-2 px-3 bg-amber-50 rounded-xl border border-amber-100 mt-2">
                  <input 
                    id="ignoreStockLimits"
                    type="checkbox" 
                    checked={!!(formData as any).ignoreStockLimits} 
                    onChange={e => setFormData({...formData, ignoreStockLimits: e.target.checked} as any)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-0 cursor-pointer"
                  />
                  <Label htmlFor="ignoreStockLimits" className="text-xs text-amber-800 font-semibold cursor-pointer select-none">Bypass Stock Validation (Allow negative stock)</Label>
                </div>
              </div>

              {formData.isJoint ? (
                <div className="p-5 bg-amber-50/50 rounded-2xl border border-amber-100/70 space-y-4">
                  <h4 className="font-serif text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse"></span>
                    Joint Print Configuration
                  </h4>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Paper stock, paper rate, and printing plates are shared dynamically from referenced job{' '}
                    <span className="font-mono font-extrabold bg-amber-100 px-1.5 py-0.5 rounded text-amber-900 border border-amber-200/60 shadow-sm">
                      #{formData.jointRef ? formData.jointRef.toUpperCase() : '????'}
                    </span>.
                  </p>
                  
                  {(() => {
                    const cleanRef = (formData.jointRef || '').trim().toUpperCase().replace('#', '');
                    const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                    return (
                      <div className="text-xs bg-white p-4 rounded-xl border border-gray-100/80 space-y-2.5">
                        {matchingJob ? (
                          <div className="space-y-3">
                            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                              <span className="text-gray-500 font-medium font-serif">Joint Job Reference:</span>
                              <span className="font-semibold text-amber-950 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200/60 shadow-2xs">
                                Job #{cleanRef} ({matchingJob.clientName})
                              </span>
                            </div>
                            
                            {/* Detected Paper */}
                            {matchingJob.items && matchingJob.items.length > 0 && (
                              <div className="text-[11px] text-gray-600 flex justify-between items-center">
                                <span className="font-medium">Detected Paper Stock:</span>
                                <span className="font-semibold text-gray-900 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                                  {stocks.find(s => s.id === matchingJob.items[0].stockId)?.name || 'Unknown Paper'}
                                </span>
                              </div>
                            )}

                            {/* Detected Plates */}
                            {matchingJob.platesUsed && matchingJob.platesUsed.length > 0 ? (
                              <div className="space-y-1.5 pt-2 border-t border-gray-100">
                                <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Detected Shareable Plates:</span>
                                {matchingJob.platesUsed.map((p, idx) => {
                                  const stock = stocks.find(s => s.id === p.plateId);
                                  return (
                                    <div key={idx} className="flex justify-between items-center text-[11px] bg-amber-50/40 px-2.5 py-1.5 rounded-lg border border-amber-100/40">
                                      <span className="font-semibold text-amber-950">{stock?.name || 'Plate'}</span>
                                      <span className="font-mono bg-amber-100/80 px-2 py-0.5 rounded text-amber-900 font-extrabold">{p.count} plates</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-[11px] text-gray-500 italic pt-1.5 border-t border-gray-100">
                                No plates detected in the referenced job.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-gray-400 italic text-center py-2 font-serif">
                            {formData.jointRef ? 'Searching / Loading referenced job details...' : 'Please enter a valid four-digit job code above'}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="joint-ups" className="text-xs font-bold text-gray-500 uppercase">Matter Ups</Label>
                      <Input 
                        id="joint-ups"
                        type="number" 
                        placeholder="e.g. 4"
                        value={formData.selectedItems[0]?.ups || ''} 
                        onChange={e => {
                          const val = e.target.value === '' ? undefined : Number(e.target.value);
                          const firstItem = formData.selectedItems[0] || { stockId: '', rate: 0, quantityUsed: 0, isJoint: true };
                          const cleanRef = (formData as any).jointRef ? (formData as any).jointRef.trim().toUpperCase().replace('#', '') : '';
                          const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                          
                          const updatedItem = {
                            ...firstItem,
                            stockId: matchingJob?.items?.[0]?.stockId || firstItem.stockId || '',
                            rate: firstItem.rate || matchingJob?.items?.[0]?.rate || 0,
                            ups: val,
                            isJoint: true,
                            paperRef: (formData as any).jointRef || ''
                          };
                          
                          // Auto calculate sheets if we have orderedQuantity and ups
                          const ordered = Number(formData.orderedQuantity) || 0;
                          const upsVal = Number(val) || 1;
                          if (upsVal > 0 && ordered > 0) {
                            const calculated = Math.ceil(ordered / upsVal);
                            updatedItem.calculatedSheets = calculated;
                            updatedItem.quantityUsed = calculated;
                          }
                          
                          setFormData({
                            ...formData,
                            selectedItems: [updatedItem]
                          });
                        }}
                        className="bg-white border-gray-200 h-10"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="joint-sheets" className="text-xs font-bold text-gray-500 uppercase">Sheet Required</Label>
                      <Input 
                        id="joint-sheets"
                        type="number" 
                        placeholder="e.g. 5000"
                        value={formData.selectedItems[0]?.calculatedSheets || formData.selectedItems[0]?.quantityUsed || ''} 
                        onChange={e => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          const firstItem = formData.selectedItems[0] || { stockId: '', rate: 0, ups: undefined, isJoint: true };
                          const cleanRef = (formData as any).jointRef ? (formData as any).jointRef.trim().toUpperCase().replace('#', '') : '';
                          const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                          
                          const updatedItem = {
                            ...firstItem,
                            stockId: matchingJob?.items?.[0]?.stockId || firstItem.stockId || '',
                            rate: firstItem.rate || matchingJob?.items?.[0]?.rate || 0,
                            calculatedSheets: val,
                            quantityUsed: val,
                            autoCalculate: false,
                            isJoint: true,
                            paperRef: (formData as any).jointRef || ''
                          };
                          
                          setFormData({
                            ...formData,
                            selectedItems: [updatedItem]
                          });
                        }}
                        className="bg-white border-gray-200 h-10"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="joint-paper-rate" className="text-xs font-bold text-gray-500 uppercase">Paper Rate (₹/500 sheets)</Label>
                      <Input 
                        id="joint-paper-rate"
                        type="number" 
                        step="any"
                        placeholder="0.00"
                        value={formData.selectedItems[0]?.rate === 0 ? '' : (formData.selectedItems[0]?.rate ?? '')} 
                        onChange={e => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          const firstItem = formData.selectedItems[0] || { stockId: '', rate: 0, quantityUsed: 0, isJoint: true };
                          const updatedItem = {
                            ...firstItem,
                            rate: val,
                            isJoint: true,
                            paperRef: (formData as any).jointRef || ''
                          };
                          setFormData({
                            ...formData,
                            selectedItems: [updatedItem]
                          });
                        }}
                        className="bg-white border-gray-200 h-10"
                        required
                      />
                      {(() => {
                        const rate = formData.selectedItems[0]?.rate || 0;
                        const sheets = formData.selectedItems[0]?.calculatedSheets || formData.selectedItems[0]?.quantityUsed || 0;
                        const ratePerSheet = rate / 500;
                        const paperCost = (sheets / 500) * rate;
                        if (rate > 0) {
                          return (
                            <p className="text-[11px] text-sky-800 font-mono mt-1">
                              ≈ ₹{ratePerSheet.toFixed(4)}/sheet | Cost for {sheets.toLocaleString()} sheets: <strong className="font-bold">₹{paperCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label className="text-lg font-serif">Papers Used</Label>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddItem} className="rounded-full">
                      <Plus className="mr-1 h-3 w-3" /> Add Paper
                    </Button>
                  </div>
                  
                  {formData.selectedItems.map((item, index) => {
                    const hasUps = item.ups !== undefined ? item.ups : 1;
                    const isAuto = item.autoCalculate !== undefined ? item.autoCalculate : true;
                    
                    return (
                      <div key={index} className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-4 relative">
                        <div className="absolute top-4 right-4">
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleRemoveItem(index)} 
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full h-8 px-2"
                          >
                            Remove Paper
                          </Button>
                        </div>

                        <h4 className="font-serif text-sm font-semibold text-gray-700">Paper Item #{index + 1}</h4>
                        
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                          <div className="md:col-span-6 space-y-1.5">
                            <Label className="text-xs font-bold text-gray-500 uppercase">Select Paper Stock</Label>
                            <StockSelect 
                              value={item.stockId} 
                              onValueChange={(v) => handleItemChange(index, 'stockId', v)}
                              stocks={stocks}
                              type="paper"
                              placeholder="Choose paper..."
                            />
                          </div>

                          <div className="md:col-span-3 space-y-1.5">
                            <Label className="text-xs font-bold text-gray-500 uppercase">Rate/500 shs (₹)</Label>
                            <Input 
                              type="number" 
                              step="any"
                              placeholder="0.00"
                              value={item.rate === 0 ? '' : item.rate} 
                              onChange={e => handleItemChange(index, 'rate', e.target.value === '' ? 0 : Number(e.target.value))} 
                              onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                              required 
                              className="bg-gray-50 border-gray-200 h-9"
                            />
                            {item.rate ? (
                              <p className="text-[10px] text-sky-700 font-mono italic mt-0.5">
                                ≈ ₹{((item.rate || 0) / 500).toFixed(4)}/sheet
                              </p>
                            ) : null}
                          </div>

                          <div className="md:col-span-3 space-y-1.5">
                            <Label className="text-xs font-bold text-gray-500 uppercase">Matter Ups</Label>
                            <Input 
                              type="number" 
                              placeholder="e.g. 4"
                              value={item.ups || ''} 
                              onChange={e => handleItemChange(index, 'ups', e.target.value === '' ? undefined : Number(e.target.value))} 
                              onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                              className="bg-gray-50 border-gray-200 h-9"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-gray-100 items-center">
                          <div className="md:col-span-5 flex items-center gap-2">
                            <input 
                              type="checkbox" 
                              id={`calc-${index}`}
                              checked={isAuto}
                              onChange={e => handleItemChange(index, 'autoCalculate', e.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-[#5A5A40] focus:ring-0 cursor-pointer"
                            />
                            <Label htmlFor={`calc-${index}`} className="text-xs text-gray-600 font-semibold cursor-pointer select-none">Auto Calculate sheets required</Label>
                          </div>

                          <div className="md:col-span-3 py-1 px-2.5 bg-gray-50 rounded-xl border border-gray-100 text-center">
                            <span className="text-[9px] font-bold text-gray-400 uppercase block">Sheets Required</span>
                            <span className="font-mono text-xs font-bold text-gray-800">
                              {isAuto ? (item.calculatedSheets || 0).toLocaleString() : 'N/A'}
                            </span>
                          </div>

                          <div className="md:col-span-4 space-y-1">
                            <Label className="text-xs font-bold text-gray-500 uppercase">Actual Sheets Consumed</Label>
                            <Input 
                              type="number" 
                              value={item.quantityUsed === 0 ? '' : item.quantityUsed} 
                              onChange={e => handleItemChange(index, 'quantityUsed', e.target.value === '' ? 0 : Number(e.target.value))} 
                              onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                              required={!formData.isJoint}
                              placeholder="sheets"
                              className="bg-gray-50 border-gray-200 h-9"
                            />
                          </div>
                        </div>
                        {!!item.isJoint && item.paperRef && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 md:bg-amber-50/70 border border-amber-100 text-[11px] text-amber-800 rounded-lg">
                            <span className="font-semibold font-mono bg-amber-200/60 px-1 py-0.5 rounded">Joint Job Reference: #{item.paperRef}</span>
                            <span>(Actual paper sheets detected from the matched referenced job's stock)</span>
                          </div>
                        )}

                        {/* Calculated rates display for single item */}
                        {(() => {
                          const billingSheets = isAuto ? (item.calculatedSheets || 0) : (item.quantityUsed || 0);
                          const ratePerSheet = (item.rate || 0) / 500;
                          const paperCost = (billingSheets / 500) * (item.rate || 0);
                          if (item.rate || billingSheets) {
                            return (
                              <div className="p-3 bg-sky-50/40 border border-sky-100 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-sky-900 font-mono">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                                  <span className="font-serif font-semibold text-sky-950">Calculated Paper Price:</span>
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1">
                                  <span>Unit Cost: <strong className="font-bold">₹{ratePerSheet.toFixed(4)}</strong>/sheet</span>
                                  <span>Total: <strong className="font-extrabold text-sky-950 underline">₹{paperCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> for {billingSheets.toLocaleString()} shs</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center">
                  <Label className="text-lg font-serif">Plates Used</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddPlate} className="rounded-full">
                    <Plus className="mr-1 h-3 w-3" /> {formData.isJoint ? 'Add Additional Plate' : 'Add Plate'}
                  </Button>
                </div>
                
                {formData.platesUsed.map((plate, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="md:col-span-11 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-gray-700">Select Plate</Label>
                        <StockSelect 
                          value={plate.plateId} 
                          onValueChange={(v) => handlePlateChange(index, 'plateId', v)}
                          stocks={stocks}
                          type="plate"
                          placeholder="Choose plate..."
                          disabled={!!plate.isJoint}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-gray-700">No. of Plates</Label>
                        <Input 
                          type="number" 
                          value={plate.count === 0 ? '' : plate.count} 
                          onChange={e => handlePlateChange(index, 'count', e.target.value === '' ? 0 : Number(e.target.value))} 
                          onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                          required={!plate.isJoint} 
                          className="bg-white"
                          disabled={!!plate.isJoint}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-gray-700">Plate Rate (₹)</Label>
                        <Input 
                          type="number" 
                          step="any"
                          placeholder="0.00"
                          value={plate.rate === 0 ? '' : plate.rate} 
                          onChange={e => handlePlateChange(index, 'rate', e.target.value === '' ? 0 : Number(e.target.value))} 
                          onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                          required={!plate.isJoint} 
                          className="bg-white"
                        />
                      </div>
                    </div>
                    <div className="md:col-span-1">
                      {!plate.isJoint ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleRemovePlate(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50 w-full p-0 flex items-center justify-center">
                          Remove
                        </Button>
                      ) : (
                        <span className="text-[10px] text-amber-600 font-mono text-center block w-full select-none cursor-not-allowed">Joint</span>
                      )}
                    </div>
                    {!!plate.isJoint && plate.plateRef && (
                      <div className="col-span-12 flex items-center gap-2 px-3 py-1 bg-amber-50/60 border border-amber-100/40 text-[10px] text-amber-800 rounded">
                        <span className="font-semibold font-mono bg-amber-200/40 px-1 rounded">Joint Reference: #{plate.plateRef}</span>
                        <span>Plate count auto-detected from matching referenced job.</span>
                      </div>
                    )}

                    {/* Calculated plates cost display */}
                    {(() => {
                      const totalPlatesCost = (plate.count || 0) * (plate.rate || 0);
                      if (plate.count || plate.rate) {
                        return (
                          <div className="col-span-12 p-2.5 bg-emerald-50/40 border border-emerald-100 rounded-xl flex items-center justify-between text-xs text-emerald-950 font-mono">
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              <span className="font-serif font-semibold text-emerald-900">Calculated Plate Cost:</span>
                            </div>
                            <span>₹{(plate.rate || 0).toLocaleString()} × {plate.count || 0} = <strong className="font-extrabold text-emerald-950 underline">₹{totalPlatesCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                ))}
              </div>

              {/* Process-wise Charges section */}
              <div className="space-y-4 border-t pt-4 border-gray-100">
                <div className="flex justify-between items-center">
                  <Label className="text-lg font-serif text-gray-900">Process-wise Charges (Cutting, Folding, UV etc.)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddCustomProcessCharge} className="rounded-full">
                    <Plus className="mr-1 h-3 w-3" /> Add Custom Process
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formData.processCharges.map((pc) => {
                    const isStandard = ['printing', 'cutting', 'folding', 'binding'].includes(pc.id);
                    return (
                      <div key={pc.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col gap-2 relative">
                        <div className="flex items-center justify-between gap-1.5">
                          {isStandard ? (
                            <span className="text-xs font-semibold uppercase tracking-wider text-[#5A5A40]">{pc.name}</span>
                          ) : (
                            <Input 
                              placeholder="Process name..." 
                              value={pc.name} 
                              onChange={e => handleProcessChargeChange(pc.id, 'name', e.target.value)}
                              className="bg-white h-7 text-xs font-semibold py-0.5"
                              required
                            />
                          )}
                          {!isStandard && (
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleRemoveProcessCharge(pc.id)} 
                              className="text-red-500 hover:text-red-700 h-6 px-1.5 py-0 text-[10px]"
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-4 text-[11px] text-gray-500 font-medium">Amount (₹)</div>
                          <div className="col-span-8">
                            <Input 
                              type="number" 
                              step="any"
                              placeholder="0.00"
                              value={pc.amount === 0 ? '' : pc.amount} 
                              onChange={e => handleProcessChargeChange(pc.id, 'amount', e.target.value === '' ? 0 : Number(e.target.value))} 
                              onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                              className="bg-white h-8 text-xs font-medium"
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-4 text-[11px] text-gray-500 font-medium">Notes</div>
                          <div className="col-span-8">
                            <Input 
                              type="text" 
                              placeholder="e.g. Matte, perfect, etc." 
                              value={pc.notes || ''} 
                              onChange={e => handleProcessChargeChange(pc.id, 'notes', e.target.value)} 
                              className="bg-white h-7 text-[10px] text-gray-600"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live Cost Calculation Summary Badge in Add Job modal */}
              {(() => {
                let paperTotal = 0;
                formData.selectedItems.forEach(item => {
                  const isAuto = item.autoCalculate !== undefined ? item.autoCalculate : true;
                  const billingSheets = isAuto ? (item.calculatedSheets || 0) : (item.quantityUsed || 0);
                  paperTotal += (billingSheets / 500) * (item.rate || 0);
                });

                let plateTotal = 0;
                formData.platesUsed.forEach(plate => {
                  plateTotal += (plate.count || 0) * (plate.rate || 0);
                });

                let processTotal = 0;
                formData.processCharges.forEach(pc => {
                  processTotal += (pc.amount || 0);
                });

                const grandTotal = paperTotal + plateTotal + processTotal;

                if (grandTotal > 0) {
                  return (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 mb-3">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Live Billing Estimation</span>
                      <div className="grid grid-cols-2 gap-y-1.5 text-xs text-slate-700 font-mono">
                        <span>Paper Stock (Total):</span>
                        <span className="text-right font-semibold">₹{paperTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span>Plates & screen (Total):</span>
                        <span className="text-right font-semibold">₹{plateTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span>Process charges:</span>
                        <span className="text-right font-semibold">₹{processTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <div className="col-span-2 border-t border-slate-200 pt-1.5 flex justify-between items-center text-sm font-bold text-slate-900 font-serif">
                          <span>Total Estimated Cost:</span>
                          <span className="text-right font-mono text-[#A8201A]">₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <DialogFooter>
                <Button type="submit" className="bg-[#5A5A40] hover:bg-[#4A4A30] w-full h-12 rounded-full text-lg">
                  Confirm Job & Update Stock
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card className="border-none shadow-sm bg-white rounded-[20px] md:rounded-[24px] overflow-hidden">
        <CardHeader className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/50">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input 
              placeholder="Search jobs..." 
              className="pl-10 bg-white border-gray-200 rounded-full h-10 md:h-11"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-50">
            {filteredJobs.map((job) => (
              <motion.div 
                key={job.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-4 md:p-6 hover:bg-gray-50/50 transition-colors"
              >
                <div className="flex flex-col lg:flex-row justify-between gap-6">
                  <div className="space-y-3 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[9px] md:text-[10px] uppercase tracking-wider text-gray-400 border-gray-200">
                        Job #{job.id.slice(-4)}
                      </Badge>
                      <span className="text-[10px] md:text-xs text-gray-400 flex items-center gap-1">
                        <Calendar size={12} />
                        {format(job.date, 'MMM dd, yyyy HH:mm')}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-lg md:text-xl font-serif font-medium text-gray-900 flex items-center gap-2">
                        <User size={18} className="text-[#5A5A40]" />
                        {job.clientName}
                      </h3>
                      <p className="text-sm md:text-base text-gray-600 mt-1">{job.jobDescription}</p>
                      {(() => {
                        const isJobJoint = !!job.isJoint || job.items.some(i => i.isJoint) || (job.platesUsed || []).some(p => p.isJoint);
                        const jobRefCode = job.jointRef || job.items.find(i => i.isJoint)?.paperRef || (job.platesUsed || []).find(p => p.isJoint)?.plateRef || '';
                        
                        if (isJobJoint && jobRefCode) {
                          return (
                            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-amber-50/70 rounded-full border border-amber-200/50 text-[#5A5A40] text-xs font-serif font-medium shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block animate-pulse"></span>
                              <span>Joint Job: Stock shared with Job #{jobRefCode.toUpperCase().replace('#', '')}</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>

                    {/* Dispatch progress representation */}
                    {(() => {
                      const totalOrdered = job.orderedQuantity || 0;
                      const dispatches = job.dispatches || [];
                      const totalDispatched = dispatches.reduce((sum, d) => sum + d.quantityShipped, 0);
                      const remainingToDispatch = Math.max(0, totalOrdered - totalDispatched);
                      const percentDispatched = totalOrdered > 0 ? Math.round((totalDispatched / totalOrdered) * 100) : 0;

                      return totalOrdered > 0 ? (
                        <div className="mt-3 p-4 bg-gray-50 rounded-2xl border border-gray-100 max-w-md font-sans">
                          <div className="flex justify-between items-center text-xs mb-1.5">
                            <span className="text-gray-500 font-medium">Dispatch Progress:</span>
                            <span className="font-mono font-semibold text-gray-700">
                              {totalDispatched.toLocaleString()} / {totalOrdered.toLocaleString()} standard units ({percentDispatched}%)
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all duration-300 ${
                                percentDispatched >= 100 ? 'bg-emerald-500' : percentDispatched > 0 ? 'bg-amber-500' : 'bg-gray-300'
                              }`}
                              style={{ width: `${Math.min(100, percentDispatched)}%` }}
                            />
                          </div>
                          <div className="flex justify-between items-center mt-2 text-[10px]">
                            <span className={`font-semibold flex items-center gap-1 ${
                              job.dispatchStatus === 'completed' ? 'text-emerald-600' : job.dispatchStatus === 'partial' ? 'text-amber-600' : 'text-gray-400'
                            }`}>
                              {job.dispatchStatus === 'completed' ? (
                                <>
                                  <CheckCircle2 size={13} />
                                  Fully Dispatched
                                </>
                              ) : job.dispatchStatus === 'partial' ? (
                                <>
                                  <Truck size={13} className="animate-pulse" />
                                  Partially Dispatched ({remainingToDispatch.toLocaleString()} remaining)
                                </>
                              ) : (
                                <>
                                  <Inbox size={13} />
                                  Pending Delivery / Dispatch
                                </>
                              )}
                            </span>
                            {dispatches.length > 0 && (
                              <span className="text-gray-400 font-serif italic text-[11px]">
                                {dispatches.length} dispatch batch{dispatches.length > 1 ? 'es' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        dispatches.length > 0 && (
                          <div className="mt-3 p-2.5 px-3 bg-purple-50/50 rounded-xl border border-purple-100/60 max-w-sm text-xs flex justify-between items-center text-purple-900 font-sans">
                            <span className="flex items-center gap-1.5 font-medium">
                              <Truck size={14} className="text-purple-600" />
                              Total Dispatched: {totalDispatched.toLocaleString()} units
                            </span>
                            <span className="text-[10px] text-purple-400 font-serif italic">
                              ({dispatches.length} shipment{dispatches.length > 1 ? 's' : ''})
                            </span>
                          </div>
                        )
                      );
                    })()}

                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className={`h-8 text-xs md:text-sm rounded-full ${
                          (() => {
                            const totalOrdered = job.orderedQuantity || 0;
                            const dispatches = job.dispatches || [];
                            const totalDispatched = dispatches.reduce((sum, d) => sum + d.quantityShipped, 0);
                            const percentDispatched = totalOrdered > 0 ? Math.round((totalDispatched / totalOrdered) * 100) : 0;
                            return percentDispatched >= 100 && totalOrdered > 0
                              ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 font-bold'
                              : 'text-amber-600 hover:text-[#5A5A40] hover:bg-amber-50';
                          })()
                        }`}
                        onClick={() => {
                          setSelectedJobForDispatch(job);
                          setIsDispatchDialogOpen(true);
                          setDispatchFormData({ quantityShipped: '', receiverName: '', notes: '' });
                        }}
                      >
                        <Truck size={14} className="mr-1" />
                        {(() => {
                          const totalOrdered = job.orderedQuantity || 0;
                          const dispatches = job.dispatches || [];
                          const totalDispatched = dispatches.reduce((sum, d) => sum + d.quantityShipped, 0);
                          const percentDispatched = totalOrdered > 0 ? Math.round((totalDispatched / totalOrdered) * 100) : 0;
                          return totalOrdered > 0 ? `Shipments (${percentDispatched}%)` : 'Dispatch Product';
                        })()}
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 text-xs md:text-sm text-gray-500 hover:text-[#5A5A40] rounded-full"
                        onClick={() => {
                          setEditingJob(job);
                          const jobRef = job.jointRef || job.items.find(i => i.isJoint)?.paperRef || (job.platesUsed || []).find(p => p.isJoint)?.plateRef || '';
                          const cleanRef = jobRef.trim().toUpperCase().replace('#', '');
                          const matchingParentJob = cleanRef ? jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef) : null;
                          
                          const childPlates = (job.platesUsed && job.platesUsed.length > 0) ? [...job.platesUsed] : [];
                          let resolvedPlates = [...childPlates];
                          
                          if (matchingParentJob && matchingParentJob.platesUsed && matchingParentJob.platesUsed.length > 0) {
                            const jointPlatesResolved = matchingParentJob.platesUsed.map(p => {
                              const stockDefault = stocks.find(s => s.id === p.plateId)?.defaultRate || 0;
                              return {
                                ...p,
                                rate: p.rate || stockDefault,
                                isJoint: true,
                                plateRef: jobRef
                              };
                            });
                            
                            resolvedPlates = [
                              ...childPlates.filter(p => !p.isJoint),
                              ...jointPlatesResolved
                            ];
                          }
                          
                          if (resolvedPlates.length === 0 && (job.isJoint || jobRef)) {
                            resolvedPlates = [{ plateId: '', count: 0, rate: 0, isJoint: true, plateRef: jobRef }];
                          }

                          let resolvedItems = [...job.items];
                          if ((job.isJoint || jobRef) && matchingParentJob && matchingParentJob.items?.[0]) {
                            const parentItem = matchingParentJob.items[0];
                            resolvedItems = resolvedItems.map((item, idx) => {
                              if (idx === 0) {
                                return {
                                  ...item,
                                  stockId: parentItem.stockId || item.stockId,
                                  rate: parentItem.rate || item.rate,
                                  ups: parentItem.ups !== undefined ? parentItem.ups : item.ups,
                                  quantityUsed: parentItem.quantityUsed || item.quantityUsed,
                                  calculatedSheets: parentItem.calculatedSheets || item.calculatedSheets,
                                  isJoint: true,
                                  paperRef: jobRef
                                };
                              }
                              return item;
                            });
                          }

                          setFormData({
                            clientName: job.clientName,
                            jobDescription: job.jobDescription,
                            selectedItems: resolvedItems,
                            platesUsed: resolvedPlates,
                            processCharges: loadProcessChargesForEditing(job),
                            ignoreStockLimits: false,
                            orderedQuantity: job.orderedQuantity || '',
                            isJoint: !!job.isJoint || job.items.some(i => i.isJoint) || (job.platesUsed || []).some(p => p.isJoint),
                            jointRef: jobRef
                          } as any);
                        }}
                      >
                        <Edit2 size={14} className="mr-1" /> Edit
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 text-xs md:text-sm text-gray-500 hover:text-red-600 rounded-full"
                        onClick={() => setJobToDelete(job)}
                      >
                        <Trash2 size={14} className="mr-1" /> Delete
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 text-xs md:text-sm text-[#5A5A40] hover:text-[#4A4A30] hover:bg-[#5A5A40]/10 font-semibold rounded-full"
                        onClick={() => setInvoiceJob(job)}
                      >
                        <FileText size={14} className="mr-1" /> Invoice
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 text-xs md:text-sm text-amber-700 hover:text-amber-900 hover:bg-amber-50/50 font-semibold rounded-full flex items-center"
                        onClick={() => setPreviewJob(job)}
                      >
                        <Printer size={14} className="mr-1" /> Print Preview
                      </Button>
                    </div>
                                   <div className="w-full mt-4 pt-4 border-t border-gray-100/60">
                    {(() => {
                      const hasNonJointItems = job.items.some(i => !i.isJoint);
                      const resolvedPlates = [...(job.platesUsed || [])];
                      if (job.isJoint && job.jointRef && jobs && jobs.length > 0) {
                        const cleanRef = job.jointRef.trim().toUpperCase().replace('#', '');
                        const referencedJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                        if (referencedJob && referencedJob.platesUsed) {
                          referencedJob.platesUsed.forEach(refPlate => {
                            const isDuplicate = resolvedPlates.some(p => p.plateId === refPlate.plateId);
                            if (!isDuplicate) {
                              resolvedPlates.push({ ...refPlate, isJoint: true } as any);
                            }
                          });
                        }
                      }
                      const hasNonJointPlates = resolvedPlates.some(p => p.plateId && !p.isJoint);
                      const hasNonJointMaterials = hasNonJointItems || hasNonJointPlates;

                      if (!hasNonJointMaterials) return null;

                      return (
                        <>
                          <h4 className="text-[10px] uppercase tracking-wider text-gray-400 font-serif italic mb-2">Materials Used</h4>
                          <div className="flex flex-row flex-wrap gap-2">
                            {job.items.map((item, idx) => {
                              const stock = stocks.find(s => s.id === item.stockId);
                              const isJoint = item.isJoint;
                              if (isJoint) return null;
                              const paperRef = item.paperRef;
                              
                              // Find other jobs sharing this same paper code/ref based on Job Codes
                              const linkedJobsForPaper = paperRef 
                                ? jobs.filter(j => {
                                    if (j.id === job.id) return false;
                                    const thisJobCode = job.id.slice(-4).toUpperCase();
                                    const otherJobCode = j.id.slice(-4).toUpperCase();
                                    const cleanRef = paperRef.trim().toUpperCase().replace('#', '');
                                    
                                    // Check 1: The other job's paperRef matches this job's code
                                    const otherSharesThis = j.items?.some(p => p.isJoint && (p.paperRef || '').trim().toUpperCase().replace('#', '') === thisJobCode);
                                    // Check 2: This paper's ref matches the other job's code
                                    const thisSharesOther = cleanRef === otherJobCode;
                                    // Check 3: Both papers reference the exact same code
                                    const sameRef = j.items?.some(p => p.isJoint && (p.paperRef || '').trim().toUpperCase().replace('#', '') === cleanRef);
                                    
                                    return otherSharesThis || thisSharesOther || sameRef;
                                  })
                                : [];

                              return (
                                <div key={`paper-item-${idx}`} className={`flex flex-col gap-1.5 p-2 md:p-3 rounded-xl border flex-1 min-w-[200px] ${
                                  isJoint 
                                    ? 'bg-amber-50/70 border-amber-200 text-amber-900' 
                                    : 'bg-gray-50 border-gray-100 text-gray-900'
                                }`}>
                                  <div className="flex justify-between items-center text-xs md:text-sm">
                                    <span className="font-medium truncate mr-2 flex items-center gap-1.5">
                                      {stock?.name || 'Unknown Stock'}
                                      {isJoint && (
                                        <Badge className="bg-amber-500 hover:bg-amber-600 border-none text-white text-[9px] h-4 px-1 leading-none">
                                          Joint Job
                                        </Badge>
                                      )}
                                    </span>
                                    <span className={`font-mono text-xs font-semibold whitespace-nowrap ${isJoint ? 'text-amber-700' : 'text-gray-500'}`}>
                                      {item.quantityUsed} sheets
                                    </span>
                                  </div>

                                  {linkedJobsForPaper.length > 0 && (
                                    <div className="text-[10px] bg-amber-100/50 p-1.5 rounded border border-amber-200 mt-1">
                                      <span className="font-semibold block text-amber-800 mb-1">Linked Jobs sharing this Paper:</span>
                                      <div className="space-y-1 max-h-[80px] overflow-y-auto">
                                        {linkedJobsForPaper.map((lj, lidx) => (
                                          <div key={lidx} className="flex justify-between items-center py-0.5 border-b border-amber-200/40 last:border-0 text-amber-900">
                                            <span className="font-medium truncate mr-2">
                                              #{lj.id.slice(-4).toUpperCase()} ({lj.clientName})
                                            </span>
                                            <span className="font-mono text-[9px] text-[#5A5A40] shrink-0 font-semibold">
                                              {lj.items?.filter(li => li.stockId === item.stockId).map(li => li.quantityUsed).join(', ') || item.quantityUsed} sheets
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {(() => {
                              const resolvedPlatesList = [...(job.platesUsed || [])];
                              if (job.isJoint && job.jointRef && jobs && jobs.length > 0) {
                                const cleanRef = job.jointRef.trim().toUpperCase().replace('#', '');
                                const referencedJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                                if (referencedJob && referencedJob.platesUsed) {
                                  referencedJob.platesUsed.forEach(refPlate => {
                                    const isDuplicate = resolvedPlatesList.some(p => p.plateId === refPlate.plateId);
                                    if (!isDuplicate) {
                                      resolvedPlatesList.push({
                                        ...refPlate,
                                        isJoint: true,
                                        plateRef: cleanRef,
                                        isJointRef: true,
                                        refJobId: referencedJob.id
                                      } as any);
                                    }
                                  });
                                }
                              }
                              
                              const validPlates = resolvedPlatesList.filter(p => p.plateId);
                              
                              return validPlates.map((plate, idx) => {
                                const stock = stocks.find(s => s.id === plate.plateId);
                                const isJoint = plate.isJoint;
                                if (isJoint) return null;
                                const plateRef = plate.plateRef;
                              
                              // Find other jobs sharing this same plate code/ref based on Job Codes
                              const linkedJobs = plateRef 
                                ? jobs.filter(j => {
                                    if (j.id === job.id) return false;
                                    const thisJobCode = job.id.slice(-4).toUpperCase();
                                    const otherJobCode = j.id.slice(-4).toUpperCase();
                                    const cleanRef = plateRef.trim().toUpperCase().replace('#', '');
                                    
                                    // Check 1: The other job's plateRef matches this job's code
                                    const otherSharesThis = j.platesUsed?.some(p => (p.plateRef || '').trim().toUpperCase().replace('#', '') === thisJobCode);
                                    // Check 2: This plate's ref matches the other job's code
                                    const thisSharesOther = cleanRef === otherJobCode;
                                    // Check 3: Both plates reference the exact same code
                                    const sameRef = j.platesUsed?.some(p => (p.plateRef || '').trim().toUpperCase().replace('#', '') === cleanRef);
                                    
                                    return otherSharesThis || thisSharesOther || sameRef;
                                  })
                                : [];
                              
                              const isAdditional = (job.isJoint || (job.jointRef && job.jointRef.trim() !== '')) && !plate.isJoint && !plate.isJointRef;
                              
                              return (
                                <div key={`plate-${idx}`} className={`flex flex-col gap-1.5 p-2 md:p-3 rounded-xl border flex-1 min-w-[200px] ${
                                  isJoint 
                                    ? 'bg-amber-50/70 border-amber-200 text-amber-900' 
                                    : isAdditional
                                      ? 'bg-pink-50/75 border-pink-100 text-pink-900 shadow-2xs'
                                      : 'bg-emerald-50 border-emerald-100 text-emerald-900'
                                }`}>
                                  <div className="flex justify-between items-center text-xs md:text-sm">
                                    <span className="font-medium truncate mr-2 flex items-center gap-1.5">
                                      {stock?.name || 'Unknown Plate'}
                                      {isJoint && (
                                        <Badge className="bg-amber-500 hover:bg-amber-600 border-none text-white text-[9px] h-4 px-1 leading-none">
                                          Joint Job
                                        </Badge>
                                      )}
                                      {isAdditional && (
                                        <Badge className="bg-pink-500 hover:bg-pink-600 border-none text-white text-[9px] h-4 px-1 leading-none uppercase tracking-wider font-bold">
                                          Additional Plate
                                        </Badge>
                                      )}
                                    </span>
                                    <span className={`font-mono text-xs font-semibold whitespace-nowrap ${isJoint ? 'text-amber-700' : isAdditional ? 'text-pink-700' : 'text-emerald-700'}`}>
                                      {plate.count} {isJoint ? 'shared ' : ''}plates
                                    </span>
                                  </div>
                                  
                                  {linkedJobs.length > 0 && (
                                    <div className="text-[10px] bg-amber-100/50 p-1.5 rounded border border-amber-200 mt-1">
                                      <span className="font-semibold block text-amber-800 mb-1">Linked Jobs on this Plate:</span>
                                      <div className="space-y-1.5 max-h-[100px] overflow-y-auto">
                                        {linkedJobs.map((lj, lidx) => {
                                          // Find matching plates in this linked job
                                          const matchingPlates = lj.platesUsed?.filter(lp => {
                                            const lpRef = (lp.plateRef || '').trim().toUpperCase().replace('#', '');
                                            const thisRef = (plateRef || '').trim().toUpperCase().replace('#', '');
                                            const thisJobCode = job.id.slice(-4).toUpperCase();
                                            const otherJobCode = lj.id.slice(-4).toUpperCase();
                                            
                                            const sharesThis = lpRef === thisJobCode;
                                            const thisSharesOther = thisRef === otherJobCode;
                                            const sameRef = thisRef !== '' && lpRef === thisRef;
                                            
                                            return sharesThis || thisSharesOther || sameRef;
                                          }) || [];
                                          
                                          // Check if all matching plates are the same plate stock ID as current plate
                                          const isSamePlateStock = matchingPlates.length > 0 && matchingPlates.every(lp => lp.plateId === plate.plateId);
                                          
                                          // Get names of matching plates in the linked job
                                          const matchingPlateNames = matchingPlates.map(lp => {
                                            const s = stocks.find(st => st.id === lp.plateId);
                                            return s ? s.name : 'Unknown Plate';
                                          }).join(', ');

                                          // Extract paper/board stock IDs and names for current job
                                          const currentPaperBoardItems = (job.items || []).filter(item => {
                                            const s = stocks.find(st => st.id === item.stockId);
                                            return s && (s.type === 'paper' || s.type === 'board');
                                          });
                                          const currentPaperBoardStockIds = currentPaperBoardItems.map(item => item.stockId);

                                          // Extract paper/board stock IDs and names for linked job
                                          const linkedPaperBoardItems = (lj.items || []).filter(item => {
                                            const s = stocks.find(st => st.id === item.stockId);
                                            return s && (s.type === 'paper' || s.type === 'board');
                                          });
                                          const linkedPaperBoardStockIds = linkedPaperBoardItems.map(item => item.stockId);

                                          // Check if paper/board is defined in both and if they match perfectly
                                          const hasPaperBoard = currentPaperBoardStockIds.length > 0 && linkedPaperBoardStockIds.length > 0;
                                          const isSamePaperBoard = hasPaperBoard && 
                                            currentPaperBoardStockIds.length === linkedPaperBoardStockIds.length &&
                                            currentPaperBoardStockIds.every(id => linkedPaperBoardStockIds.includes(id));

                                          // Display names of papers/boards
                                          const currentPaperBoardNames = currentPaperBoardItems.map(item => {
                                            const s = stocks.find(st => st.id === item.stockId);
                                            return s ? s.name : 'Unknown';
                                          }).join(', ');

                                          const linkedPaperBoardNames = linkedPaperBoardItems.map(item => {
                                            const s = stocks.find(st => st.id === item.stockId);
                                            return s ? s.name : 'Unknown';
                                          }).join(', ');

                                          return (
                                            <div key={lidx} className="border-t border-amber-200/40 pt-1 mt-1 first:border-t-0 first:pt-0 first:mt-0 space-y-1">
                                              <div className="flex justify-between items-center text-[9px] text-amber-900">
                                                <span className="truncate max-w-[120px] font-medium">• {lj.clientName}</span>
                                                <span className="truncate max-w-[100px] italic text-amber-700">({lj.jobDescription})</span>
                                              </div>
                                              <div className="flex flex-col gap-1 pl-2 text-[8.5px]">
                                                {/* Plate matching check */}
                                                <div>
                                                  {isSamePlateStock ? (
                                                    <span className="text-emerald-700 font-medium flex items-center gap-1">
                                                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                      <span>Plate Stock Matches:</span> <span className="font-mono text-gray-700 bg-emerald-100/40 px-1 rounded">{matchingPlateNames || 'Same'}</span>
                                                    </span>
                                                  ) : (
                                                    <span className="text-amber-800 font-semibold flex flex-wrap items-center gap-1 bg-rose-50 border border-rose-100 rounded px-1 py-0.5 text-[8px]" title={`Current: ${stock?.name || 'Unknown'}, Linked: ${matchingPlateNames}`}>
                                                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                                                      <span className="text-rose-700 font-bold">Plate Mismatch!</span> 
                                                      <span className="text-rose-900 font-mono ml-0.5">Linked uses: {matchingPlateNames || 'None'}</span>
                                                    </span>
                                                  )}
                                                </div>

                                                {/* Paper/board matching check */}
                                                <div>
                                                  {!hasPaperBoard ? (
                                                    <span className="text-amber-700/80 font-medium flex items-center gap-1">
                                                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                                                      <span>Paper/Board Undefined:</span> <span className="italic text-gray-500">Add paper to both jobs to verify match</span>
                                                    </span>
                                                  ) : isSamePaperBoard ? (
                                                    <span className="text-emerald-700 font-medium flex items-center gap-1">
                                                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                      <span>Paper/Board Matches:</span> <span className="font-mono text-gray-700 bg-emerald-100/40 px-1 rounded">{linkedPaperBoardNames}</span>
                                                    </span>
                                                  ) : (
                                                    <span className="text-amber-800 font-semibold flex flex-wrap items-center gap-1 bg-rose-50 border border-rose-100 rounded px-1 py-0.5 text-[8px]" title={`Current: ${currentPaperBoardNames || 'None'}, Linked: ${linkedPaperBoardNames || 'None'}`}>
                                                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                                                      <span className="text-rose-700 font-bold">Paper/Board Mismatch!</span> 
                                                      <span className="text-rose-900 font-mono ml-0.5">Linked uses: {linkedPaperBoardNames || 'None'}</span>
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </>
                    );
                  })()}

                      {/* Shared Materials Details Card */}
                      {(() => {
                        const jointItems = job.items.filter(i => i.isJoint);
                        const resolvedPlatesListForShared = [...(job.platesUsed || [])];
                        if (job.isJoint && job.jointRef && jobs && jobs.length > 0) {
                          const cleanRef = job.jointRef.trim().toUpperCase().replace('#', '');
                          const referencedJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                          if (referencedJob && referencedJob.platesUsed) {
                            referencedJob.platesUsed.forEach(refPlate => {
                              const isDuplicate = resolvedPlatesListForShared.some(p => p.plateId === refPlate.plateId);
                              if (!isDuplicate) {
                                resolvedPlatesListForShared.push({
                                  ...refPlate,
                                  isJoint: true,
                                  plateRef: cleanRef,
                                  isJointRef: true,
                                  refJobId: referencedJob.id
                                } as any);
                              }
                            });
                          }
                        }
                        const jointPlates = resolvedPlatesListForShared.filter(p => p.plateId && p.isJoint);

                        if (jointItems.length === 0 && jointPlates.length === 0) return null;

                        return (
                          <div className="mt-3 bg-amber-50/60 border border-amber-200/50 rounded-xl p-3 shadow-xs">
                            <h5 className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block"></span>
                              Shared / Joint Materials Details
                            </h5>
                            
                            <div className="flex flex-row flex-wrap gap-2">
                              {/* Joint Paper Items */}
                              {jointItems.map((item, idx) => {
                                const stock = stocks.find(s => s.id === item.stockId);
                                const paperRef = item.paperRef;
                                return (
                                  <div key={`joint-item-${idx}`} className="text-xs bg-white/80 p-2.5 rounded-lg border border-amber-100/70 flex flex-col gap-1 shadow-2xs flex-1 min-w-[160px]">
                                    <div className="flex justify-between items-start gap-1">
                                      <span className="font-semibold text-amber-950 truncate">
                                        {stock?.name || 'Unknown Stock'}
                                      </span>
                                      <span className="font-semibold font-mono text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded leading-none shrink-0 uppercase">
                                        Joint Paper
                                      </span>
                                    </div>
                                    <div className="flex justify-between text-[11px] text-amber-900/80 mt-1">
                                      <span>Sheets Required:</span>
                                      <span className="font-bold font-mono text-amber-950">{item.quantityUsed} sheets</span>
                                    </div>
                                    {paperRef && (
                                      <div className="text-[10px] text-amber-800/80 mt-1.5 pt-1.5 border-t border-amber-100/50 flex items-center justify-between">
                                        <span>Linked to Job Code:</span>
                                        <span className="font-extrabold font-mono text-[#5A5A40] bg-amber-100/70 px-1.5 py-0.5 rounded uppercase">#{paperRef.toUpperCase().replace('#', '')}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}

                              {/* Joint Plates */}
                              {jointPlates.map((plate, idx) => {
                                const stock = stocks.find(s => s.id === plate.plateId);
                                const plateRef = plate.plateRef;
                                return (
                                  <div key={`joint-plate-${idx}`} className="text-xs bg-white/80 p-2.5 rounded-lg border border-amber-100/70 flex flex-col gap-1 shadow-2xs flex-1 min-w-[160px]">
                                    <div className="flex justify-between items-start gap-1">
                                      <span className="font-semibold text-amber-950 truncate">
                                        {stock?.name || 'Unknown Plate'}
                                      </span>
                                      <span className="font-semibold font-mono text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded leading-none shrink-0 uppercase">
                                        Joint Plate
                                      </span>
                                    </div>
                                    <div className="flex justify-between text-[11px] text-amber-900/80 mt-1">
                                      <span>Plates Required:</span>
                                      <span className="font-bold font-mono text-amber-950">{plate.count} plates</span>
                                    </div>
                                    {plateRef && (
                                      <div className="text-[10px] text-amber-800/80 mt-1.5 pt-1.5 border-t border-amber-100/50 flex items-center justify-between">
                                        <span>Linked to Job Code:</span>
                                        <span className="font-extrabold font-mono text-[#5A5A40] bg-amber-100/70 px-1.5 py-0.5 rounded uppercase">#{plateRef.toUpperCase().replace('#', '')}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Process-wise Charges summary in Job listing */}
                      {job.processCharges && job.processCharges.some(pc => (pc.amount || 0) > 0) && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          <h4 className="text-[10px] uppercase tracking-wider text-gray-400 font-serif italic mb-2">Process Charges</h4>
                          <div className="flex flex-wrap gap-1.5 font-serif">
                            {job.processCharges.filter(pc => (pc.amount || 0) > 0).map((pc, idx) => (
                              <span key={idx} className="inline-flex text-[11px] text-gray-700 bg-gray-50 px-2 py-1 rounded-md border border-gray-100" title={pc.notes}>
                                {pc.name} {pc.notes ? `(${pc.notes})` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
            {filteredJobs.length === 0 && (
              <div className="py-20 text-center text-gray-500 font-serif italic">
                No jobs recorded yet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {jobToDelete && (
        <Dialog open={!!jobToDelete} onOpenChange={() => setJobToDelete(null)}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Delete Job</DialogTitle>
            </DialogHeader>
            <div className="py-6">
              <p className="text-gray-600">Are you sure you want to delete the job for <span className="font-bold text-gray-900">{jobToDelete.clientName}</span>? This will return the used stock to inventory.</p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setJobToDelete(null)} className="rounded-full">Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteJob} className="rounded-full px-8">Delete Job</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <InvoiceModal 
        isOpen={!!invoiceJob} 
        onClose={() => setInvoiceJob(null)} 
        job={invoiceJob} 
        stocks={stocks} 
        jobs={jobs}
      />

      {previewJob && (
        <JobPreviewModal
          isOpen={!!previewJob}
          onClose={() => setPreviewJob(null)}
          job={previewJob}
          stocks={stocks}
          jobs={jobs}
        />
      )}

      {editingJob && (
        <Dialog open={!!editingJob} onOpenChange={() => {
          setEditingJob(null);
          setFormData({ clientName: '', jobDescription: '', selectedItems: [], platesUsed: [], processCharges: getInitialProcessCharges(), ignoreStockLimits: false, orderedQuantity: '', isJoint: false, jointRef: '' } as any);
        }}>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Job</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpdateJob} className="space-y-6 py-4">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50/50 rounded-2xl border border-gray-100 shadow-xs">
                  <div className="space-y-2">
                    <Label htmlFor="edit-clientName" className="flex items-center gap-1 text-sm font-semibold text-gray-700">
                      <span>Client Name</span>
                      <span className="text-red-500 font-bold">*</span>
                    </Label>
                    <Input id="edit-clientName" value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})} required className="bg-white border-gray-200" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-jobDescription" className="flex items-center gap-1 text-sm font-semibold text-gray-700">
                      <span>Job Description</span>
                      <span className="text-red-500 font-bold">*</span>
                    </Label>
                    <Input id="edit-jobDescription" value={formData.jobDescription} onChange={e => setFormData({...formData, jobDescription: e.target.value})} required className="bg-white border-gray-200" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-orderedQuantity" className="flex items-center gap-1">
                    <span>Ordered Finished Product Quantity</span>
                    <span className="text-red-500 font-bold">*</span>
                  </Label>
                  <Input 
                    id="edit-orderedQuantity" 
                    type="number" 
                    placeholder="e.g. 10000" 
                    value={formData.orderedQuantity} 
                    onChange={e => handleOrderedQuantityChange(e.target.value)} 
                    required
                  />
                </div>
                <div className="flex flex-col md:flex-row gap-4 p-4 bg-amber-50/50 rounded-2xl border border-amber-100/70 mt-3 space-y-3 md:space-y-0">
                  <div className="flex items-center gap-2">
                    <input 
                      id="edit-isJointJob"
                      type="checkbox" 
                      checked={!!(formData as any).isJoint} 
                      onChange={e => handleJointJobToggle(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-0 cursor-pointer"
                    />
                    <Label htmlFor="edit-isJointJob" className="text-sm text-amber-800 font-bold cursor-pointer select-none">This is a Joint Job</Label>
                  </div>
                  {!!(formData as any).isJoint && (
                    <div className="flex-1 space-y-1">
                      <Label className="text-[10px] font-bold text-gray-500 uppercase">Shared Joint Job Reference Code</Label>
                      <Input 
                        type="text" 
                        placeholder="Job Code to share paper & plates with (e.g. A3B8)" 
                        list="active-jobs-list"
                        value={(formData as any).jointRef || ''} 
                        onChange={e => handleJointJobRefChange(e.target.value)}
                        className="bg-white h-9 text-xs rounded-lg font-mono uppercase"
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 py-2 px-3 bg-amber-50 rounded-xl border border-amber-100 mt-2">
                  <input 
                    id="edit-ignoreStockLimits"
                    type="checkbox" 
                    checked={!!(formData as any).ignoreStockLimits} 
                    onChange={e => setFormData({...formData, ignoreStockLimits: e.target.checked} as any)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-0 cursor-pointer"
                  />
                  <Label htmlFor="edit-ignoreStockLimits" className="text-xs text-amber-800 font-semibold cursor-pointer select-none">Bypass Stock Validation (Allow negative stock)</Label>
                </div>
              </div>

              {formData.isJoint ? (
                <div className="p-5 bg-amber-50/50 rounded-2xl border border-amber-100/70 space-y-4">
                  <h4 className="font-serif text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse"></span>
                    Joint Print Configuration
                  </h4>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Paper stock, paper rate, and printing plates are shared dynamically from referenced job{' '}
                    <span className="font-mono font-extrabold bg-amber-100 px-1.5 py-0.5 rounded text-amber-900 border border-amber-200/60 shadow-sm">
                      #{formData.jointRef ? formData.jointRef.toUpperCase() : '????'}
                    </span>.
                  </p>
                  
                  {(() => {
                    const cleanRef = (formData.jointRef || '').trim().toUpperCase().replace('#', '');
                    const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                    return (
                      <div className="text-xs bg-white p-4 rounded-xl border border-gray-100/80 space-y-2.5">
                        {matchingJob ? (
                          <div className="space-y-3">
                            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                              <span className="text-gray-500 font-medium font-serif">Joint Job Reference:</span>
                              <span className="font-semibold text-amber-950 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200/60 shadow-2xs">
                                Job #{cleanRef} ({matchingJob.clientName})
                              </span>
                            </div>
                            
                            {/* Detected Paper */}
                            {matchingJob.items && matchingJob.items.length > 0 && (
                              <div className="text-[11px] text-gray-600 flex justify-between items-center">
                                <span className="font-medium">Detected Paper Stock:</span>
                                <span className="font-semibold text-gray-900 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                                  {stocks.find(s => s.id === matchingJob.items[0].stockId)?.name || 'Unknown Paper'}
                                </span>
                              </div>
                            )}

                            {/* Detected Plates */}
                            {matchingJob.platesUsed && matchingJob.platesUsed.length > 0 ? (
                              <div className="space-y-1.5 pt-2 border-t border-gray-100">
                                <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Detected Shareable Plates:</span>
                                {matchingJob.platesUsed.map((p, idx) => {
                                  const stock = stocks.find(s => s.id === p.plateId);
                                  return (
                                    <div key={idx} className="flex justify-between items-center text-[11px] bg-amber-50/40 px-2.5 py-1.5 rounded-lg border border-amber-100/40">
                                      <span className="font-semibold text-amber-950">{stock?.name || 'Plate'}</span>
                                      <span className="font-mono bg-amber-100/80 px-2 py-0.5 rounded text-amber-900 font-extrabold">{p.count} plates</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-[11px] text-gray-500 italic pt-1.5 border-t border-gray-100">
                                No plates detected in the referenced job.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-gray-400 italic text-center py-2 font-serif">
                            {formData.jointRef ? 'Searching / Loading referenced job details...' : 'Please enter a valid four-digit job code above'}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-joint-ups" className="text-xs font-bold text-gray-500 uppercase">Matter Ups</Label>
                      <Input 
                        id="edit-joint-ups"
                        type="number" 
                        placeholder="e.g. 4"
                        value={formData.selectedItems[0]?.ups || ''} 
                        onChange={e => {
                          const val = e.target.value === '' ? undefined : Number(e.target.value);
                          const firstItem = formData.selectedItems[0] || { stockId: '', rate: 0, quantityUsed: 0, isJoint: true };
                          const cleanRef = (formData as any).jointRef ? (formData as any).jointRef.trim().toUpperCase().replace('#', '') : '';
                          const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                          
                          const updatedItem = {
                            ...firstItem,
                            stockId: matchingJob?.items?.[0]?.stockId || firstItem.stockId || '',
                            rate: firstItem.rate || matchingJob?.items?.[0]?.rate || 0,
                            ups: val,
                            isJoint: true,
                            paperRef: (formData as any).jointRef || ''
                          };
                          
                          // Auto calculate sheets if we have orderedQuantity and ups
                          const ordered = Number(formData.orderedQuantity) || 0;
                          const upsVal = Number(val) || 1;
                          if (upsVal > 0 && ordered > 0) {
                            const calculated = Math.ceil(ordered / upsVal);
                            updatedItem.calculatedSheets = calculated;
                            updatedItem.quantityUsed = calculated;
                          }
                          
                          setFormData({
                            ...formData,
                            selectedItems: [updatedItem]
                          });
                        }}
                        className="bg-white border-gray-200 h-10"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="edit-joint-sheets" className="text-xs font-bold text-gray-500 uppercase">Sheet Required</Label>
                      <Input 
                        id="edit-joint-sheets"
                        type="number" 
                        placeholder="e.g. 5000"
                        value={formData.selectedItems[0]?.calculatedSheets || formData.selectedItems[0]?.quantityUsed || ''} 
                        onChange={e => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          const firstItem = formData.selectedItems[0] || { stockId: '', rate: 0, ups: undefined, isJoint: true };
                          const cleanRef = (formData as any).jointRef ? (formData as any).jointRef.trim().toUpperCase().replace('#', '') : '';
                          const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                          
                          const updatedItem = {
                            ...firstItem,
                            stockId: matchingJob?.items?.[0]?.stockId || firstItem.stockId || '',
                            rate: firstItem.rate || matchingJob?.items?.[0]?.rate || 0,
                            calculatedSheets: val,
                            quantityUsed: val,
                            autoCalculate: false,
                            isJoint: true,
                            paperRef: (formData as any).jointRef || ''
                          };
                          
                          setFormData({
                            ...formData,
                            selectedItems: [updatedItem]
                          });
                        }}
                        className="bg-white border-gray-200 h-10"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="edit-joint-paper-rate" className="text-xs font-bold text-gray-500 uppercase">Paper Rate (₹)</Label>
                      <Input 
                        id="edit-joint-paper-rate"
                        type="number" 
                        step="any"
                        placeholder="0.00"
                        value={formData.selectedItems[0]?.rate === 0 ? '' : (formData.selectedItems[0]?.rate ?? '')} 
                        onChange={e => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          const firstItem = formData.selectedItems[0] || { stockId: '', rate: 0, quantityUsed: 0, isJoint: true };
                          const updatedItem = {
                            ...firstItem,
                            rate: val,
                            isJoint: true,
                            paperRef: (formData as any).jointRef || ''
                          };
                          setFormData({
                            ...formData,
                            selectedItems: [updatedItem]
                          });
                        }}
                        className="bg-white border-gray-200 h-10"
                        required
                      />
                      {(() => {
                        const rate = formData.selectedItems[0]?.rate || 0;
                        const sheets = formData.selectedItems[0]?.calculatedSheets || formData.selectedItems[0]?.quantityUsed || 0;
                        const ratePerSheet = rate / 500;
                        const paperCost = (sheets / 500) * rate;
                        if (rate > 0) {
                          return (
                            <p className="text-[11px] text-sky-800 font-mono mt-1">
                              ≈ ₹{ratePerSheet.toFixed(4)}/sheet | Cost for {sheets.toLocaleString()} sheets: <strong className="font-bold">₹{paperCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label className="text-lg font-serif">Papers Used</Label>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddItem} className="rounded-full">
                      <Plus className="mr-1 h-3 w-3" /> Add Paper
                    </Button>
                  </div>
                  
                  {formData.selectedItems.map((item, index) => {
                    const hasUps = item.ups !== undefined ? item.ups : 1;
                    const isAuto = item.autoCalculate !== undefined ? item.autoCalculate : true;

                    return (
                      <div key={index} className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-4 relative">
                        <div className="absolute top-4 right-4">
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleRemoveItem(index)} 
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full h-8 px-2"
                          >
                            Remove Paper
                          </Button>
                        </div>

                        <h4 className="font-serif text-sm font-semibold text-gray-700">Paper Item #{index + 1}</h4>
                        
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                          <div className="md:col-span-6 space-y-1.5">
                            <Label className="text-xs font-bold text-gray-500 uppercase">Select Paper Stock</Label>
                            <StockSelect 
                              value={item.stockId} 
                              onValueChange={(v) => handleItemChange(index, 'stockId', v)}
                              stocks={stocks}
                              type="paper"
                              placeholder="Choose paper..."
                            />
                          </div>

                          <div className="md:col-span-3 space-y-1.5">
                            <Label className="text-xs font-bold text-gray-500 uppercase">Rate/500 shs (₹)</Label>
                            <Input 
                              type="number" 
                              step="any"
                              placeholder="0.00"
                              value={item.rate === 0 ? '' : item.rate} 
                              onChange={e => handleItemChange(index, 'rate', e.target.value === '' ? 0 : Number(e.target.value))} 
                              onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                              required 
                              className="bg-gray-50 border-gray-200 h-9"
                            />
                            {item.rate ? (
                              <p className="text-[10px] text-sky-700 font-mono italic mt-0.5">
                                ≈ ₹{((item.rate || 0) / 500).toFixed(4)}/sheet
                              </p>
                            ) : null}
                          </div>

                          <div className="md:col-span-3 space-y-1.5">
                            <Label className="text-xs font-bold text-gray-500 uppercase">Matter Ups</Label>
                            <Input 
                              type="number" 
                              placeholder="e.g. 4"
                              value={item.ups || ''} 
                              onChange={e => handleItemChange(index, 'ups', e.target.value === '' ? undefined : Number(e.target.value))} 
                              onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                              className="bg-gray-50 border-gray-200 h-9"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-gray-100 items-center">
                          <div className="md:col-span-5 flex items-center gap-2">
                            <input 
                              type="checkbox" 
                              id={`edit-calc-${index}`}
                              checked={isAuto}
                              onChange={e => handleItemChange(index, 'autoCalculate', e.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-[#5A5A40] focus:ring-0 cursor-pointer"
                            />
                            <Label htmlFor={`edit-calc-${index}`} className="text-xs text-gray-600 font-semibold cursor-pointer select-none">Auto Calculate sheets required</Label>
                          </div>

                          <div className="md:col-span-3 py-1 px-2.5 bg-gray-50 rounded-xl border border-gray-100 text-center">
                            <span className="text-[9px] font-bold text-gray-400 uppercase block">Sheets Required</span>
                            <span className="font-mono text-xs font-bold text-gray-800">
                              {isAuto ? (item.calculatedSheets || 0).toLocaleString() : 'N/A'}
                            </span>
                          </div>

                          <div className="md:col-span-4 space-y-1">
                            <Label className="text-xs font-bold text-gray-500 uppercase">Actual Sheets Consumed</Label>
                            <Input 
                              type="number" 
                              value={item.quantityUsed === 0 ? '' : item.quantityUsed} 
                              onChange={e => handleItemChange(index, 'quantityUsed', e.target.value === '' ? 0 : Number(e.target.value))} 
                              onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                              required={!formData.isJoint}
                              placeholder="sheets"
                              className="bg-gray-50 border-gray-200 h-9"
                            />
                          </div>
                        </div>
                        {!!item.isJoint && item.paperRef && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 md:bg-amber-50/70 border border-amber-100 text-[11px] text-amber-800 rounded-lg">
                            <span className="font-semibold font-mono bg-amber-200/60 px-1 py-0.5 rounded">Joint Job Reference: #{item.paperRef}</span>
                            <span>(Actual paper sheets detected from the matched referenced job's stock)</span>
                          </div>
                        )}

                        {/* Calculated rates display for single item */}
                        {(() => {
                          const billingSheets = isAuto ? (item.calculatedSheets || 0) : (item.quantityUsed || 0);
                          const ratePerSheet = (item.rate || 0) / 500;
                          const paperCost = (billingSheets / 500) * (item.rate || 0);
                          if (item.rate || billingSheets) {
                            return (
                              <div className="p-3 bg-sky-50/40 border border-sky-100 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-sky-900 font-mono">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                                  <span className="font-serif font-semibold text-sky-950">Calculated Paper Price:</span>
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1">
                                  <span>Unit Cost: <strong className="font-bold">₹{ratePerSheet.toFixed(4)}</strong>/sheet</span>
                                  <span>Total: <strong className="font-extrabold text-sky-950 underline">₹{paperCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> for {billingSheets.toLocaleString()} shs</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center">
                  <Label className="text-lg font-serif">Plates Used</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddPlate} className="rounded-full">
                    <Plus className="mr-1 h-3 w-3" /> {formData.isJoint ? 'Add Additional Plate' : 'Add Plate'}
                  </Button>
                </div>
                
                {formData.platesUsed.map((plate, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="md:col-span-11 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-gray-700">Select Plate</Label>
                        <StockSelect 
                          value={plate.plateId} 
                          onValueChange={(v) => handlePlateChange(index, 'plateId', v)}
                          stocks={stocks}
                          type="plate"
                          placeholder="Choose plate..."
                          disabled={!!plate.isJoint}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-gray-700">No. of Plates</Label>
                        <Input 
                          type="number" 
                          value={plate.count === 0 ? '' : plate.count} 
                          onChange={e => handlePlateChange(index, 'count', e.target.value === '' ? 0 : Number(e.target.value))} 
                          onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                          required={!plate.isJoint} 
                          className="bg-white"
                          disabled={!!plate.isJoint}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-gray-700">Plate Rate (₹)</Label>
                        <Input 
                          type="number" 
                          step="any"
                          placeholder="0.00"
                          value={plate.rate === 0 ? '' : plate.rate} 
                          onChange={e => handlePlateChange(index, 'rate', e.target.value === '' ? 0 : Number(e.target.value))} 
                          onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                          required={!plate.isJoint} 
                          className="bg-white"
                        />
                      </div>
                    </div>
                    <div className="md:col-span-1">
                      {!plate.isJoint ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleRemovePlate(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50 w-full p-0 flex items-center justify-center">
                          Remove
                        </Button>
                      ) : (
                        <span className="text-[10px] text-amber-600 font-mono text-center block w-full select-none cursor-not-allowed">Joint</span>
                      )}
                    </div>
                    {!!plate.isJoint && plate.plateRef && (
                      <div className="col-span-12 flex items-center gap-2 px-3 py-1 bg-amber-50/60 border border-amber-100/40 text-[10px] text-amber-800 rounded">
                        <span className="font-semibold font-mono bg-amber-200/40 px-1 rounded">Joint Reference: #{plate.plateRef}</span>
                        <span>Plate count auto-detected from matching referenced job.</span>
                      </div>
                    )}

                    {/* Calculated plates cost display */}
                    {(() => {
                      const totalPlatesCost = (plate.count || 0) * (plate.rate || 0);
                      if (plate.count || plate.rate) {
                        return (
                          <div className="col-span-12 p-2.5 bg-emerald-50/40 border border-emerald-100 rounded-xl flex items-center justify-between text-xs text-emerald-950 font-mono">
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              <span className="font-serif font-semibold text-emerald-900">Calculated Plate Cost:</span>
                            </div>
                            <span>₹{(plate.rate || 0).toLocaleString()} × {plate.count || 0} = <strong className="font-extrabold text-emerald-950 underline">₹{totalPlatesCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                ))}
              </div>

              {/* Process-wise Charges section */}
              <div className="space-y-4 border-t pt-4 border-gray-100">
                <div className="flex justify-between items-center">
                  <Label className="text-lg font-serif text-gray-900">Process-wise Charges (Cutting, Folding, UV etc.)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddCustomProcessCharge} className="rounded-full">
                    <Plus className="mr-1 h-3 w-3" /> Add Custom Process
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formData.processCharges.map((pc) => {
                    const isStandard = ['printing', 'cutting', 'folding', 'binding'].includes(pc.id);
                    return (
                      <div key={pc.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col gap-2 relative">
                        <div className="flex items-center justify-between gap-1.5">
                          {isStandard ? (
                            <span className="text-xs font-semibold uppercase tracking-wider text-[#5A5A40]">{pc.name}</span>
                          ) : (
                            <Input 
                              placeholder="Process name..." 
                              value={pc.name} 
                              onChange={e => handleProcessChargeChange(pc.id, 'name', e.target.value)}
                              className="bg-white h-7 text-xs font-semibold py-0.5"
                              required
                            />
                          )}
                          {!isStandard && (
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleRemoveProcessCharge(pc.id)} 
                              className="text-red-500 hover:text-red-700 h-6 px-1.5 py-0 text-[10px]"
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                        
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-4 text-[11px] text-gray-500 font-medium">Amount (₹)</div>
                          <div className="col-span-8">
                            <Input 
                              type="number" 
                              step="any"
                              placeholder="0.00"
                              value={pc.amount === 0 ? '' : pc.amount} 
                              onChange={e => handleProcessChargeChange(pc.id, 'amount', e.target.value === '' ? 0 : Number(e.target.value))} 
                              onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                              className="bg-white h-8 text-xs font-medium"
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-4 text-[11px] text-gray-500 font-medium">Notes</div>
                          <div className="col-span-8">
                            <Input 
                              type="text" 
                              placeholder="e.g. Matte, perfect, etc." 
                              value={pc.notes || ''} 
                              onChange={e => handleProcessChargeChange(pc.id, 'notes', e.target.value)} 
                              className="bg-white h-7 text-[10px] text-gray-600"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live Cost Calculation Summary Badge in Edit Job modal */}
              {(() => {
                let paperTotal = 0;
                formData.selectedItems.forEach(item => {
                  const isAuto = item.autoCalculate !== undefined ? item.autoCalculate : true;
                  const billingSheets = isAuto ? (item.calculatedSheets || 0) : (item.quantityUsed || 0);
                  paperTotal += (billingSheets / 500) * (item.rate || 0);
                });

                let plateTotal = 0;
                formData.platesUsed.forEach(plate => {
                  plateTotal += (plate.count || 0) * (plate.rate || 0);
                });

                let processTotal = 0;
                formData.processCharges.forEach(pc => {
                  processTotal += (pc.amount || 0);
                });

                const grandTotal = paperTotal + plateTotal + processTotal;

                if (grandTotal > 0) {
                  return (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 mb-3">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Live Billing Estimation</span>
                      <div className="grid grid-cols-2 gap-y-1.5 text-xs text-slate-700 font-mono">
                        <span>Paper Stock (Total):</span>
                        <span className="text-right font-semibold">₹{paperTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span>Plates & screen (Total):</span>
                        <span className="text-right font-semibold">₹{plateTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span>Process charges:</span>
                        <span className="text-right font-semibold">₹{processTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <div className="col-span-2 border-t border-slate-200 pt-1.5 flex justify-between items-center text-sm font-bold text-slate-900 font-serif">
                          <span>Total Estimated Cost:</span>
                          <span className="text-right font-mono text-[#A8201A]">₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <DialogFooter>
                <Button type="submit" className="bg-[#5A5A40] hover:bg-[#4A4A30] w-full h-12 rounded-full text-lg">
                  Update Job & Reconcile Stock
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {isDispatchDialogOpen && selectedJobForDispatch && (
        <Dialog open={isDispatchDialogOpen} onOpenChange={(open) => {
          setIsDispatchDialogOpen(open);
          if (!open) setSelectedJobForDispatch(null);
        }}>
          <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                <Truck className="text-[#5A5A40]" />
                <span>Dispatch Shipments</span>
              </DialogTitle>
              <div className="text-sm text-gray-500 font-serif italic">
                {selectedJobForDispatch.clientName} — {selectedJobForDispatch.jobDescription}
              </div>
            </DialogHeader>

            {/* Quick Summary Cards */}
            {(() => {
              const currentJobObj = jobs.find(j => j.id === selectedJobForDispatch.id) || selectedJobForDispatch;
              const totalOrdered = currentJobObj.orderedQuantity || 0;
              const dispatches = currentJobObj.dispatches || [];
              const totalDispatched = dispatches.reduce((sum, d) => sum + d.quantityShipped, 0);
              const remainingToDispatch = totalOrdered > 0 ? Math.max(0, totalOrdered - totalDispatched) : 0;
              const percentDispatched = totalOrdered > 0 ? Math.round((totalDispatched / totalOrdered) * 100) : 0;

              return (
                <div className="space-y-6 my-4">
                  {/* Progress Stats Banner */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 font-mono uppercase">Ordered</p>
                      <p className="text-lg font-bold text-gray-800">{totalOrdered > 0 ? totalOrdered.toLocaleString() : 'N/A'}</p>
                    </div>
                    <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-100">
                      <p className="text-[10px] text-amber-600 font-mono uppercase">Dispatched</p>
                      <p className="text-lg font-bold text-amber-700">{totalDispatched.toLocaleString()}</p>
                    </div>
                    <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-100">
                      <p className="text-[10px] text-emerald-600 font-mono uppercase">Remaining</p>
                      <p className="text-lg font-bold text-emerald-700">{totalOrdered > 0 ? remainingToDispatch.toLocaleString() : '∞'}</p>
                    </div>
                  </div>

                  {totalOrdered > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-gray-500 font-medium">
                        <span>Total Shipped: {percentDispatched}%</span>
                        <span>{remainingToDispatch === 0 ? 'All delivered!' : `${remainingToDispatch.toLocaleString()} units left`}</span>
                      </div>
                      <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-350 ${
                            percentDispatched >= 100 ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                          style={{ width: `${Math.min(100, percentDispatched)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Add New Dispatch log */}
                  <form onSubmit={(e) => handleRecordDispatch(e)} className="p-4 bg-gray-50 rounded-2xl border border-gray-200/60 space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                      <Plus size={14} className="text-[#5A5A40]" />
                      Record Direct Dispatch Shipment
                    </h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="disp-qty" className="text-xs text-gray-600">Quantity Dispatched *</Label>
                        <Input 
                          id="disp-qty"
                          type="number"
                          placeholder={remainingToDispatch > 0 ? `e.g. ${remainingToDispatch}` : "e.g. 1000"}
                          value={dispatchFormData.quantityShipped}
                          onChange={e => setDispatchFormData({ ...dispatchFormData, quantityShipped: e.target.value })}
                          onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                          required
                          className="bg-white border-gray-200 rounded-lg h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="disp-receiver" className="text-xs text-gray-600">Received/Collected By</Label>
                        <Input 
                          id="disp-receiver"
                          type="text"
                          placeholder="e.g. Driver Ali / Client Rep"
                          value={dispatchFormData.receiverName}
                          onChange={e => setDispatchFormData({ ...dispatchFormData, receiverName: e.target.value })}
                          className="bg-white border-gray-200 rounded-lg h-9"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-1.5">
                      <Label htmlFor="disp-notes" className="text-xs text-gray-600">Tracking Info / Notes</Label>
                      <Input 
                        id="disp-notes"
                        type="text"
                        placeholder="e.g. Vehicle No: ABC-1234, Gate Pass No: 618"
                        value={dispatchFormData.notes}
                        onChange={e => setDispatchFormData({ ...dispatchFormData, notes: e.target.value })}
                        className="bg-white border-gray-200 rounded-lg h-9"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button 
                        type="submit" 
                        className="flex-1 bg-[#5A5A40] hover:bg-[#4A4A30] text-white rounded-lg h-10 font-medium text-xs md:text-sm"
                      >
                        Record Shipment
                      </Button>
                      {totalOrdered > 0 && remainingToDispatch > 0 && (
                        <Button 
                          type="button" 
                          variant="outline"
                          onClick={(e) => handleRecordDispatch(e, remainingToDispatch)}
                          className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-lg h-10 text-xs font-semibold"
                        >
                          Dispatch Remaining ({remainingToDispatch.toLocaleString()})
                        </Button>
                      )}
                    </div>
                  </form>

                  {/* Shipment Logs History */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 font-serif italic">
                        Dispatch & Collection Log History
                      </h4>
                      {dispatches.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadDispatchHistory(currentJobObj)}
                          className="h-7 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 px-2 rounded-lg flex items-center gap-1.5 transition-colors"
                          title="Download dispatch history report (CSV)"
                        >
                          <Download size={13} />
                          <span>Download CSV</span>
                        </Button>
                      )}
                    </div>

                    {dispatches.length === 0 ? (
                      <div className="py-6 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl italic font-serif">
                        No dispatches logged yet for this job order.
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto border border-gray-100 rounded-xl bg-white shadow-sm">
                        {dispatches.map((disp) => (
                          <div key={disp.id} className="p-3 text-xs flex justify-between items-center hover:bg-gray-50/50">
                            <div className="space-y-1 flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded text-[11px]">
                                  +{disp.quantityShipped.toLocaleString()} units
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {format(disp.date, 'MMM dd, yyyy HH:mm')}
                                </span>
                              </div>
                              {disp.receiverName && (
                                <p className="text-gray-600 font-sans">
                                  <span className="font-medium text-gray-700">Collected by:</span> {disp.receiverName}
                                </p>
                              )}
                              {disp.notes && (
                                <p className="text-gray-500 italic max-w-sm truncate text-[10px]">
                                  Ref: {disp.notes}
                                </p>
                              )}
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              type="button"
                              onClick={() => handleDeleteDispatch(disp.id)}
                              className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 p-0 rounded-full shrink-0"
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => {
                setIsDispatchDialogOpen(false);
                setSelectedJobForDispatch(null);
              }} className="rounded-full w-full">
                Close Dispatch Board
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {isClearConfirmOpen && (
        <Dialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Clear Jobs History</DialogTitle>
            </DialogHeader>
            <div className="py-6">
              <p className="text-gray-600">
                Are you sure you want to permanently clear the jobs history? This will delete <span className="font-bold text-gray-900">all job orders</span> from the system. Stock values are unaffected. This action is irreversible.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setIsClearConfirmOpen(false)} className="rounded-full" disabled={isClearing}>Cancel</Button>
              <Button variant="destructive" onClick={handleClearJobs} className="rounded-full px-8 font-serif" disabled={isClearing}>
                {isClearing ? 'Clearing...' : 'Clear Jobs History'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <datalist id="active-jobs-list">
        {jobs.map(j => (
          <option key={j.id} value={j.id.slice(-4).toUpperCase()}>
            {`Job #${j.id.slice(-4).toUpperCase()} — ${j.clientName} (${j.jobDescription})`}
          </option>
        ))}
      </datalist>
    </div>
  );
}
