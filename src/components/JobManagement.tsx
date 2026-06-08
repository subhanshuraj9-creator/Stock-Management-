import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType, cleanUndefined, auth } from '../firebase';
import { collection, onSnapshot, addDoc, query, orderBy, runTransaction, doc, writeBatch, getDocs, where } from 'firebase/firestore';
import { Job, StockItem, JobItem, JointRun, JointRunAuditLog } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Plus, Search, FileText, Calendar, User, Edit2, Trash2, Truck, Inbox, CheckCircle2, Download, Printer, ChevronDown } from 'lucide-react';
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
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleScroll = (event: Event) => {
      if (isOpen) {
        // If the scroll happened inside our own dropdown container (e.g. scrolling the options list),
        // do not close. Only close when scrolling the parent modal/form container.
        if (containerRef.current && containerRef.current.contains(event.target as Node)) {
          return;
        }
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('scroll', handleScroll, { capture: true });
    }
    return () => {
      document.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [isOpen]);

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
    <div className="relative w-full text-left" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setSearch('');
          }
        }}
        className="flex w-full items-center justify-between gap-1.5 rounded-lg border border-gray-200 bg-white py-2 px-3 text-sm h-9 cursor-pointer hover:border-gray-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50 text-left"
        disabled={disabled}
      >
        <span className="truncate text-gray-700">
          {value ? displayLabel : <span className="text-gray-400">{placeholder}</span>}
        </span>
        <ChevronDown className="pointer-events-none size-4 text-gray-400 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg bg-white border border-gray-200 shadow-xl max-h-72 flex flex-col overflow-hidden animate-fadeIn">
          <div className="p-2 border-b border-gray-100 bg-gray-50 flex items-center gap-1.5">
            <Search className="h-4 w-4 text-gray-400 shrink-0 ml-1" />
            <input 
              type="text"
              autoFocus
              placeholder={`Search ${type}...`} 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-transparent border-0 outline-none p-0 text-sm h-8"
              onKeyDown={e => {
                if (e.key === ' ') {
                  e.stopPropagation();
                }
              }}
            />
          </div>
          
          <div className="overflow-y-auto max-h-56 divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-400 italic">
                No matching {type} found. Ensure they are configured in Stock Management.
              </div>
            ) : (
              filtered.map(s => {
                const itemLabel = `${s.name} ${type === 'paper' ? `(${s.gsm ? `${s.gsm} GSM, ` : ''}${s.size || ''})` : (s.size ? `(${s.size})` : '')}`;
                const isSelected = s.id === value;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      onValueChange(s.id);
                      setIsOpen(false);
                    }}
                    className={`flex justify-between items-center w-full px-3 py-2.5 text-xs text-left cursor-pointer hover:bg-gray-50 transition-colors ${
                      isSelected ? 'bg-indigo-50/70 text-indigo-700 font-semibold' : 'text-gray-700'
                    }`}
                  >
                    <span className="truncate pr-2">{itemLabel}</span>
                    <span className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">
                      {s.quantity} left
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface BillingSectionProps {
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  rawJobs: Job[];
  getPaperQuantityForBilling: (tempForm: any, allJobs: any[]) => number;
  calculatePaperBillingAmount: (method: string, rate: number, qty: number) => number;
  stocks: StockItem[];
  recalculateAllocatedPapersForForm: (tempFormData: any, allJobs: any[]) => any[];
}

const BillingSection = ({
  formData,
  setFormData,
  rawJobs,
  getPaperQuantityForBilling,
  calculatePaperBillingAmount,
  stocks,
  recalculateAllocatedPapersForForm
}: BillingSectionProps) => {
  const paperQty = getPaperQuantityForBilling(formData, rawJobs);
  const paperMethod = formData.paperBillingMethod;
  const paperRate = Number(formData.paperBillingRate) || 0;

  // Calculate paper stock costs from the Papers Used list
  const paperStockCost = useMemo(() => {
    const resolvedItems = recalculateAllocatedPapersForForm(formData, rawJobs);
    return resolvedItems.reduce((sum: number, item: any) => {
      const qty = item.allocatedPaper !== undefined ? item.allocatedPaper : (Number(item.quantityUsed) || 0);
      const rate = Number(item.paperRate) || 0;
      return sum + (qty * rate);
    }, 0);
  }, [formData.selectedItems, rawJobs, recalculateAllocatedPapersForForm]);

  // Sync / Calculate billing amount live
  const calculatedPaperAmt = useMemo(() => {
    if (paperMethod === 'custom') {
      return Number(formData.paperBillingAmount) || 0;
    }
    return calculatePaperBillingAmount(paperMethod, paperRate, paperQty);
  }, [paperMethod, paperRate, paperQty, formData.paperBillingAmount, calculatePaperBillingAmount]);

  // Plate summation:
  const plateBreakdown = useMemo(() => {
    let sharedPlatesCount = 0;
    let sharedPlatesBilling = 0;
    let additionalPlatesCount = 0;
    let additionalPlatesBilling = 0;
    let standardPlatesCount = 0;
    let standardPlatesBilling = 0;

    formData.platesUsed.forEach((p: any) => {
      const rate = Number(p.rate) || 0;
      const count = Number(p.count) || 0;
      const isShared = !!p.isJoint;
      const isAdditional = !!p.isAdditionalPlate;

      if (isShared) {
        sharedPlatesCount += count;
        sharedPlatesBilling += rate * count;
      } else if (isAdditional) {
        additionalPlatesCount += count;
        additionalPlatesBilling += rate * count;
      } else {
        standardPlatesCount += count;
        standardPlatesBilling += rate * count;
      }
    });

    const totalPlateBilling = sharedPlatesBilling + additionalPlatesBilling + standardPlatesBilling;
    return {
      sharedPlatesCount,
      sharedPlatesBilling,
      additionalPlatesCount,
      additionalPlatesBilling,
      standardPlatesCount,
      standardPlatesBilling,
      totalPlateBilling
    };
  }, [formData.platesUsed]);

  // Process Charges:
  const totalProcessCharges = useMemo(() => {
    return formData.processCharges.reduce((sum: number, pc: any) => {
      if (!formData.isJoint && (pc.id === 'cutting' || pc.id === 'folding')) {
        return sum;
      }
      return sum + (Number(pc.amount) || 0);
    }, 0);
  }, [formData.processCharges, formData.isJoint]);

  // Lamination charges:
  const lamiDetails = useMemo(() => {
    const halfLami = formData.lamination?.halfEnabled ? (Number(formData.lamination.halfQty || 0) * Number(formData.lamination.halfRate || 0)) : 0;
    const fullLami = formData.lamination?.fullEnabled ? (Number(formData.lamination.fullQty || 0) * Number(formData.lamination.fullRate || 0)) : 0;
    const totalLami = halfLami + fullLami;
    return { halfLami, fullLami, totalLami };
  }, [formData.lamination]);

  // Other/Additional Charges:
  const otherCharges = Number(formData.additionalCharges) || 0;

  // Total value:
  const totalJobValue = calculatedPaperAmt + plateBreakdown.totalPlateBilling + totalProcessCharges + lamiDetails.totalLami + otherCharges;

  return (
    <div className="space-y-6 pt-4 border-t border-gray-100">
      <div>
        <Label className="text-lg font-serif text-gray-900 block mb-3">Billing & Customer Rates</Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50/50 rounded-2xl border border-gray-100 shadow-xs">
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-gray-700">Paper Billing Rate Type</Label>
            <Select 
              value={paperMethod || 'none'} 
              onValueChange={(val) => {
                const methodVal = val === 'none' ? '' : val;
                setFormData((prev: any) => {
                  const updated = { 
                    ...prev, 
                    paperBillingMethod: methodVal
                  };
                  if (methodVal !== 'custom') {
                    const qty = getPaperQuantityForBilling(updated, rawJobs);
                    const calculatedAmt = calculatePaperBillingAmount(methodVal, Number(updated.paperBillingRate) || 0, qty);
                    updated.paperBillingAmount = calculatedAmt;
                  }
                  return updated;
                });
              }}
            >
              <SelectTrigger className="w-full bg-white border-gray-200 h-10 rounded-xl text-xs focus:ring-[#5A5A40]">
                <SelectValue placeholder="Select billing model" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">No Billing (None)</SelectItem>
                  <SelectItem value="ream">Per Ream (500 sheets)</SelectItem>
                  <SelectItem value="100sheets">Per 100 Sheets</SelectItem>
                  <SelectItem value="gross">Per Gross (144 sheets)</SelectItem>
                  <SelectItem value="custom">Custom Flat Amount</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-gray-700">
              {paperMethod === 'custom' ? 'Billing Rate Note / Reference' : 'Paper Billing Rate (₹)'}
            </Label>
            <Input 
              type={paperMethod === 'custom' ? 'text' : 'number'}
              step="any"
              disabled={!paperMethod}
              placeholder={!paperMethod ? 'N/A' : 'Rate (₹)'}
              value={paperMethod ? (formData.paperBillingRate === 0 && paperMethod !== 'custom' ? '' : formData.paperBillingRate) : ''}
              onChange={e => {
                const val = e.target.value;
                setFormData((prev: any) => {
                  const updated = {
                    ...prev,
                    paperBillingRate: val === '' ? 0 : paperMethod === 'custom' ? val : Number(val)
                  };
                  if (paperMethod !== 'custom') {
                    const qty = getPaperQuantityForBilling(updated, rawJobs);
                    const calculatedAmt = calculatePaperBillingAmount(updated.paperBillingMethod, Number(updated.paperBillingRate) || 0, qty);
                    updated.paperBillingAmount = calculatedAmt;
                  }
                  return updated;
                });
              }}
              className="bg-white focus-visible:ring-[#5A5A40]"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-gray-700">Paper Billing Amount (₹)</Label>
            <Input 
              type="number"
              step="any"
              disabled={paperMethod !== 'custom'}
              readOnly={paperMethod !== 'custom'}
              placeholder="0.00"
              value={paperMethod ? (formData.paperBillingAmount === 0 ? '' : formData.paperBillingAmount) : ''}
              onChange={e => {
                if (paperMethod === 'custom') {
                  const val = e.target.value === '' ? 0 : Number(e.target.value);
                  setFormData((prev: any) => ({
                    ...prev,
                    paperBillingAmount: val
                  }));
                }
              }}
              className={paperMethod !== 'custom' ? 'bg-gray-100 font-mono text-gray-500' : 'bg-white font-mono text-gray-900 focus-visible:ring-[#5A5A40]'}
            />
            {paperMethod && paperMethod !== 'custom' && (
              <p className="text-[10px] text-gray-400 font-serif italic">
                Auto-calculated from {paperQty} sheets
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-gray-700">Additional / Other Charges (₹)</Label>
            <Input 
              type="number"
              step="any"
              placeholder="e.g. Loading, freight (₹)"
              value={formData.additionalCharges === 0 ? '' : formData.additionalCharges}
              onChange={e => {
                const val = e.target.value === '' ? 0 : Number(e.target.value);
                setFormData((prev: any) => ({
                  ...prev,
                  additionalCharges: val
                }));
              }}
              className="bg-white font-mono focus-visible:ring-[#5A5A40]"
            />
          </div>
        </div>
      </div>

      {/* Live Billing Summary Card */}
      <div className="p-5 bg-gray-50 rounded-2xl border border-gray-150 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-200/60 pb-2">
          <span className="text-xs font-bold text-[#5A5A40] uppercase tracking-wider">Live Job Value Estimation</span>
          <Badge className="bg-[#5A5A40]/10 text-[#5A5A40] hover:bg-[#5A5A40]/10 text-[9px] font-mono border-none uppercase">Preview Only</Badge>
        </div>
        
        <div className="space-y-2.5 text-xs font-medium text-gray-600">
          
          <div className="flex justify-between items-center">
            <span>Paper Billing {paperMethod ? (paperMethod === 'custom' ? '(Custom Amount)' : `(${paperQty} Sheets @ ${paperMethod === 'ream' ? `₹${paperRate}/ream` : paperMethod === '100sheets' ? `₹${paperRate}/100 sheets` : `₹${paperRate}/gross`})`) : ''}:</span>
            <span className="font-mono font-semibold text-gray-900">
              ₹ {calculatedPaperAmt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          
          <div className="flex flex-col gap-1 py-1 px-2.5 bg-white/40 rounded-xl border border-gray-100">
            {formData.isJoint && (
              <div className="flex justify-between items-center text-[10px] text-gray-500">
                <span>• Shared Plates count ({plateBreakdown.sharedPlatesCount}):</span>
                <span className="font-mono">₹ {plateBreakdown.sharedPlatesBilling.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-[10px] text-gray-500">
              <span>• Additional Plates count ({plateBreakdown.additionalPlatesCount}):</span>
              <span className="font-mono">₹ {plateBreakdown.additionalPlatesBilling.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            {plateBreakdown.standardPlatesCount > 0 && (
              <div className="flex justify-between items-center text-[10px] text-gray-500">
                <span>• Standard Plates count ({plateBreakdown.standardPlatesCount}):</span>
                <span className="font-mono">₹ {plateBreakdown.standardPlatesBilling.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-0.5 mt-0.5 border-t border-gray-100 text-gray-700 font-semibold text-[11px]">
              <span>Total Plate Billing:</span>
              <span className="font-mono">₹ {plateBreakdown.totalPlateBilling.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
          
          <div className="flex justify-between items-center">
            <span>Process Charges:</span>
            <span className="font-mono font-semibold text-gray-900 font-sans">
              ₹ {totalProcessCharges.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          
          <div className="flex flex-col gap-1 py-1 px-2.5 bg-white/40 rounded-xl border border-gray-100">
            {formData.lamination?.halfEnabled && (
              <div className="flex justify-between items-center text-[10px] text-gray-500">
                <span>• Half Lamination ({formData.lamination.halfQty || 0} units):</span>
                <span className="font-mono">₹ {lamiDetails.halfLami.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
            {formData.lamination?.fullEnabled && (
              <div className="flex justify-between items-center text-[10px] text-gray-500">
                <span>• Full Lamination ({formData.lamination.fullQty || 0} units):</span>
                <span className="font-mono">₹ {lamiDetails.fullLami.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-0.5 mt-0.5 border-t border-gray-100 text-gray-700 font-semibold text-[11px]">
              <span>Total Lamination:</span>
              <span className="font-mono">₹ {lamiDetails.totalLami.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="flex justify-between items-center pb-1">
            <span>Other Charges:</span>
            <span className="font-mono font-semibold text-gray-900 font-sans">
              ₹ {otherCharges.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        
        <div className="bg-[#5A5A40]/5 rounded-xl p-4 border border-[#5A5A40]/10 flex flex-col items-center justify-center gap-1">
          <span className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-wider">Estimated Job Value</span>
          <span className="text-2xl md:text-3xl font-serif font-extrabold text-[#5A5A40] font-sans">
            ₹ {totalJobValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
};

const getInitialProcessCharges = () => [
  { id: 'printing', name: 'Printing', amount: 0, notes: '' },
  { id: 'cutting', name: 'Cutting', amount: 0, notes: '' },
  { id: 'folding', name: 'Folding', amount: 0, notes: '' },
  { id: 'binding', name: 'Binding', amount: 0, notes: '' }
];

const getInitialSelectedItems = () => [
  { stockId: '', quantityUsed: 0, ups: 1, isJoint: false, paperRef: '', paperRate: 0 }
];

const getInitialPlatesUsed = () => [
  { plateId: '', count: 0, isJoint: false, plateRef: '', rate: 0, isAdditionalPlate: false }
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
  const [rawJobs, setRawJobs] = useState<Job[]>([]);
  const [jointRuns, setJointRuns] = useState<JointRun[]>([]);
  const [auditLogs, setAuditLogs] = useState<JointRunAuditLog[]>([]);
  const [isAuditLogsOpen, setIsAuditLogsOpen] = useState(false);
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [invoiceJob, setInvoiceJob] = useState<Job | null>(null);
  const [previewJob, setPreviewJob] = useState<Job | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const jobs = useMemo(() => {
    return synchronizeJobsData(rawJobs, jointRuns);
  }, [rawJobs, jointRuns]);

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

  const getInitialLamination = () => ({
    halfEnabled: false,
    halfQty: 0,
    halfRate: 0,
    fullEnabled: false,
    fullQty: 0,
    fullRate: 0
  });

  const [formData, setFormData] = useState({
    clientName: '',
    jobDescription: '',
    selectedItems: getInitialSelectedItems() as JobItem[],
    platesUsed: getInitialPlatesUsed() as { plateId: string; count: number; isJoint?: boolean; plateRef?: string; rate?: number; isReused?: boolean; isCancelled?: boolean; cancelledColor?: string; isAdditionalPlate?: boolean; }[],
    processCharges: getInitialProcessCharges(),
    lamination: getInitialLamination(),
    ignoreStockLimits: false,
    orderedQuantity: '' as string | number,
    isJoint: false,
    jointJobType: '' as 'master' | 'linked' | '',
    sharedRunId: '',
    jointParentId: '',
    jointRef: '',
    isRepeat: false,
    repeatRef: '',
    date: new Date().toISOString().split('T')[0],
    paperBillingMethod: '' as '100sheets' | 'gross' | 'ream' | 'custom' | '',
    paperBillingRate: 0,
    paperBillingAmount: 0,
    additionalCharges: 0
  });

  function getJobRunId(job: any): string {
    if (job.sharedRunId) return job.sharedRunId.trim().toUpperCase();
    if (job.isJoint) {
      if (job.jointRef) {
        return job.jointRef.trim().toUpperCase().replace('#', '');
      }
      if (job.id) {
        return job.id.slice(-4).toUpperCase();
      }
    }
    return '';
  }

  function synchronizeJobsData(
    allJobs: any[], 
    allJointRuns: JointRun[] = jointRuns,
    editingId?: string,
    editingFormData?: any
  ): any[] {
    let finalJointRuns = [...allJointRuns];

    if (editingId && editingFormData && editingFormData.isJoint && editingFormData.jointJobType === 'master') {
      const runId = editingFormData.sharedRunId || editingFormData.jointRef || "XXXX";
      const paperStockId = editingFormData.selectedItems?.[0]?.stockId || '';
      const paperItemFromStock = stocks.find(s => s.id === paperStockId);

      const virtualJr: JointRun = {
        id: runId,
        sharedRunId: runId,
        paper: {
          stockId: paperStockId,
          paperSize: editingFormData.paperSize || paperItemFromStock?.size || '',
          paperSection: editingFormData.paperSection || paperItemFromStock?.paperType || '',
          paperNotes: editingFormData.paperNotes || '',
          productionNotes: editingFormData.productionNotes || '',
          paperRate: editingFormData.selectedItems?.[0]?.paperRate || 0
        },
        totalSheetsUsed: Number(editingFormData.selectedItems?.[0]?.quantityUsed) || 0,
        wastageSheets: Number(editingFormData.selectedItems?.[0]?.wastageSheets) || 0,
        sharedPlates: (editingFormData.platesUsed || []).filter((p: any) => p.isJoint).map((p: any) => ({
          plateId: p.plateId,
          count: Number(p.count),
          rate: Number(p.rate) || 0,
          isJoint: true,
          plateRef: runId
        })),
        linkedJobs: []
      };

      const idx = finalJointRuns.findIndex(r => r.sharedRunId === runId);
      if (idx !== -1) {
        finalJointRuns[idx] = virtualJr;
      } else {
        finalJointRuns.push(virtualJr);
      }
    }

    // 1. Resolve paper/rate copy & alignment across groups based on JointRuns first
    const jobsWithResolvedJoints = allJobs.map(job => {
      const resolvedJob = {
        ...job,
        items: (job.items || []).map((it: any) => ({ ...it })),
        platesUsed: (job.platesUsed || []).map((it: any) => ({ ...it }))
      };

      if (resolvedJob.isJoint && resolvedJob.sharedRunId) {
        // Find JointRun
        const jr = finalJointRuns.find(r => r.sharedRunId === resolvedJob.sharedRunId);
        if (jr) {
          // Merge Paper Stock, Total Sheets Used, Wastage Sheets, Size, Section, Notes
          resolvedJob.items = (resolvedJob.items || []).map((it: any) => {
            return {
              ...it,
              stockId: jr.paper?.stockId || it.stockId,
              quantityUsed: jr.totalSheetsUsed !== undefined ? jr.totalSheetsUsed : it.quantityUsed,
              wastageSheets: jr.wastageSheets !== undefined ? jr.wastageSheets : it.wastageSheets,
              paperRate: jr.paper?.paperRate !== undefined ? jr.paper.paperRate : it.paperRate,
              isJoint: true,
              paperRef: jr.sharedRunId
            };
          });

          // If items helper is empty, initialize it!
          if (resolvedJob.items.length === 0) {
            resolvedJob.items = [{
              stockId: jr.paper?.stockId || '',
              quantityUsed: jr.totalSheetsUsed !== undefined ? jr.totalSheetsUsed : 0,
              wastageSheets: jr.wastageSheets !== undefined ? jr.wastageSheets : 0,
              paperRate: jr.paper?.paperRate !== undefined ? jr.paper.paperRate : 0,
              ups: 1,
              isJoint: true,
              paperRef: jr.sharedRunId
            }];
          }

          // Populate paper details
          resolvedJob.paperSize = jr.paper?.paperSize || '';
          resolvedJob.paperSection = jr.paper?.paperSection || '';
          resolvedJob.paperNotes = jr.paper?.paperNotes || '';
          resolvedJob.productionNotes = jr.paper?.productionNotes || '';

          // Merge plates
          const nonJointPlates = (job.platesUsed || []).filter((p: any) => !p.isJoint);
          const sharedPlates = (jr.sharedPlates || []).map((p: any) => ({
            ...p,
            isJoint: true,
            plateRef: jr.sharedRunId
          }));
          resolvedJob.platesUsed = [...sharedPlates, ...nonJointPlates];
        }
      }
      return resolvedJob;
    });

    // 2. Identify modern and legacy groups
    const runIdToGroupJobs = new Map<string, any[]>();
    jobsWithResolvedJoints.forEach(job => {
      const runId = getJobRunId(job);
      if (runId) {
        if (!runIdToGroupJobs.has(runId)) {
          runIdToGroupJobs.set(runId, []);
        }
        runIdToGroupJobs.get(runId)!.push(job);
      }
    });

    // For any group, if there is no matching JointRun, we do the fallback in-memory synchronization
    runIdToGroupJobs.forEach((group, runId) => {
      const hasRealRun = finalJointRuns.some(r => r.sharedRunId === runId);
      if (!hasRealRun) {
        const masterJob = group.find(j => j.jointJobType === 'master') || 
                          group.find(j => j.id && j.id.slice(-4).toUpperCase() === runId) ||
                          group[0];

        if (masterJob) {
          group.forEach(job => {
            if (job.id !== masterJob.id) {
              job.items = (masterJob.items || []).map((masterItem: any, idx: number) => {
                const currentItem = job.items?.[idx] || {};
                return {
                  ...currentItem,
                  stockId: masterItem.stockId,
                  paperRate: masterItem.paperRate || 0,
                  quantityUsed: masterItem.quantityUsed || 0,
                  wastageSheets: masterItem.wastageSheets || 0,
                  isJoint: true,
                  paperRef: runId
                };
              });
            }
          });
        }
      }

      // Re-calculate ordered quantities and allocations inside group
      const firstJob = group[0];
      if (firstJob) {
        const firstItems = firstJob.items || [];
        firstItems.forEach((fItem: any, idx: number) => {
          const masterActual = Number(fItem.quantityUsed) || 0;

          let totalTheoretical = 0;
          const jobToTheoretical = new Map<string, number>();

          group.forEach(job => {
            const item = job.items?.[idx];
            if (item) {
              const ups = Number(item.ups) || 1;
              const actualUsed = Number(item.quantityUsed) || 0;
              const theoretical = actualUsed * ups;
              jobToTheoretical.set(job.id, theoretical);
              totalTheoretical += theoretical;
            }
          });

          group.forEach(job => {
            const item = job.items?.[idx];
            if (item) {
              const theoretical = jobToTheoretical.get(job.id) || 0;
              let allocated = 0;
              if (totalTheoretical > 0) {
                allocated = Math.round((theoretical / totalTheoretical) * masterActual);
              }
              item.allocatedPaper = allocated;
            }
          });
        });

        // Compute orderedQuantity for each job
        group.forEach(job => {
          job.orderedQuantity = (job.items || []).reduce((acc: number, item: any) => {
            return acc + (Number(item.quantityUsed || 0) * (Number(item.ups) || 1));
          }, 0);
        });
      }
    });

    // 3. For standard jobs, allocatedPaper = quantityUsed
    jobsWithResolvedJoints.forEach(job => {
      const inJointGroup = Array.from(runIdToGroupJobs.values()).some(group => 
        group.some(gj => gj.id === job.id)
      );

      if (!inJointGroup) {
        job.items = (job.items || []).map((item: any) => ({
          ...item,
          allocatedPaper: Number(item.quantityUsed) || 0
        }));
        job.orderedQuantity = (job.items || []).reduce((acc: number, item: any) => {
          return acc + (Number(item.quantityUsed || 0) * (Number(item.ups) || 1));
        }, 0);
      }
    });

    return jobsWithResolvedJoints;
  }

  const recalculateAllocatedPapersForForm = (tempFormData: any, allJobs: any[]): JobItem[] => {
    const currentId = tempFormData.id || (editingJob ? editingJob.id : undefined) || "TEMP_EDIT_JOB_ID_XXXX";
    const withTempJob = [{ 
      ...tempFormData, 
      id: currentId,
      items: tempFormData.selectedItems ? [...tempFormData.selectedItems] : [],
      isJoint: !!tempFormData.isJoint,
      jointJobType: tempFormData.jointJobType,
      sharedRunId: tempFormData.sharedRunId,
      jointRef: tempFormData.jointRef
    }];
    
    allJobs.forEach(job => {
      if (job.id !== currentId) {
        withTempJob.push(job);
      }
    });

    const synchronized = synchronizeJobsData(withTempJob, jointRuns, currentId, tempFormData);
    const resolvedTempJob = synchronized.find(j => j.id === currentId);
    return resolvedTempJob?.items || tempFormData.selectedItems || [];
  };

  const getPaperQuantityForBilling = (tempForm: any, allJobs: any[]): number => {
    const resolvedItems = recalculateAllocatedPapersForForm(tempForm, allJobs);
    return resolvedItems.reduce((sum, item) => {
      const qty = item.allocatedPaper !== undefined ? item.allocatedPaper : (Number(item.quantityUsed) || 0);
      return sum + qty;
    }, 0);
  };

  const calculatePaperBillingAmount = (method: string, rate: number, qty: number): number => {
    if (method === 'custom') {
      return 0; // Handled as manual input directly
    }
    if (!method || !rate || !qty) return 0;
    let calculated = 0;
    switch (method) {
      case '100sheets':
        calculated = (qty / 100) * rate;
        break;
      case 'gross':
        calculated = (qty / 144) * rate;
        break;
      case 'ream':
        calculated = (qty / 500) * rate;
        break;
      default:
        calculated = 0;
    }
    return Math.round(calculated * 100) / 100;
  };

  useEffect(() => {
    const billingMethod = formData.paperBillingMethod;
    const billingRate = formData.paperBillingRate;
    
    if (billingMethod === 'custom' || !billingMethod) {
      // In custom or undefined state, we do not run automatic calculations.
      return;
    }
    
    const qty = getPaperQuantityForBilling(formData, rawJobs);
    const calculatedAmt = calculatePaperBillingAmount(billingMethod, Number(billingRate) || 0, qty);
    
    if (formData.paperBillingAmount !== calculatedAmt) {
      setFormData(prev => ({
        ...prev,
        paperBillingAmount: calculatedAmt
      }));
    }
  }, [
    formData.paperBillingMethod,
    formData.paperBillingRate,
    formData.isJoint,
    formData.jointJobType,
    formData.sharedRunId,
    formData.jointRef,
    JSON.stringify(formData.selectedItems),
    rawJobs.length,
    JSON.stringify(jointRuns)
  ]);

  useEffect(() => {
    const jobsQ = query(collection(db, 'jobs'), orderBy('date', 'desc'));
    const unsubscribeJobs = onSnapshot(jobsQ, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job));
      setRawJobs(items);
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

    const jointRunsQ = query(collection(db, 'jointRuns'));
    const unsubscribeJointRuns = onSnapshot(jointRunsQ, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JointRun));
      setJointRuns(items);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'jointRuns');
    });

    const auditLogsQ = query(collection(db, 'jointRunAuditLogs'));
    const unsubscribeAuditLogs = onSnapshot(auditLogsQ, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JointRunAuditLog));
      const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);
      setAuditLogs(sorted);
    }, (error) => {
      console.warn("Audit logs error: ", error);
    });

    return () => {
      unsubscribeJobs();
      unsubscribeStocks();
      unsubscribeJointRuns();
      unsubscribeAuditLogs();
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
          ups: 1,
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
    const tempForm = { ...formData, orderedQuantity: val };
    const finalItems = recalculateAllocatedPapersForForm(tempForm, jobs);
    setFormData({ ...tempForm, selectedItems: finalItems });
  };

  const applyJointRefAndAutoDetect = (refCode: string, items = formData.selectedItems, plates = formData.platesUsed) => {
    const cleanRef = refCode.trim().toUpperCase().replace('#', '');
    const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
    
    // For joint jobs, we always want exactly one paper item in selectedItems
    let updatedItems = [...items];
    if (updatedItems.length === 0) {
      updatedItems = [{
        stockId: '',
        quantityUsed: 0,
        ups: 1,
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
      
      if (matchingJob) {
        const matchingItem = matchingJob.items?.[idx];
        if (matchingItem) {
          updatedItem.stockId = matchingItem.stockId || '';
          updatedItem.quantityUsed = matchingItem.quantityUsed || 0;
          updatedItem.ups = item.ups !== undefined ? item.ups : 1;
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

        if (p.isCancelled) {
          // If the parent plate is cancelled, create it as a standard chargeable plate for the local job
          return {
            plateId: p.plateId,
            count: p.count,
            rate: rateToUse,
            isJoint: false,
            plateRef: '',
            isReused: false,
            isCancelled: false
          };
        }

        return {
          ...p,
          rate: rateToUse,
          isJoint: true,
          plateRef: refCode
        };
      });
    }

    const tempForm = {
      ...formData,
      isJoint: true,
      jointRef: refCode,
      selectedItems: updatedItems,
      platesUsed: updatedPlates
    };
    const finalItems = recalculateAllocatedPapersForForm(tempForm, jobs);
    setFormData({ ...tempForm, selectedItems: finalItems } as any);

    if (matchingJob && cleanRef.length === 4) {
      const matchedPaperStock = stocks.find(s => s.id === matchingJob.items?.[0]?.stockId);
      const stockMsg = matchedPaperStock ? ` (Stock: ${matchedPaperStock.name})` : '';
      toast.success(`Connected to Job #${cleanRef}${stockMsg}. Material & Plate stocks synchronized!`);
    }
  };

  const getCalculatedReusedPlates = (platesUsed: any[]) => {
    const res: { plateId: string; count: number; rate: number; isJoint: boolean; plateRef: string; isReused: boolean; isCancelled: boolean; isAdditionalPlate: boolean; label?: string }[] = [];
    
    platesUsed.forEach((p) => {
      const stockDefault = stocks.find(s => s.id === p.plateId)?.defaultRate || 0;
      const rateToUse = p.rate || stockDefault;

      if (p.isCancelled) {
        const cancelledCount = (p.cancelledColor || '').split('/').filter(Boolean).length || 1;
        const remainingCount = Math.max(0, p.count - cancelledCount);
        
        if (remainingCount > 0) {
          res.push({
            plateId: p.plateId,
            count: remainingCount,
            rate: rateToUse,
            isJoint: false,
            plateRef: '',
            isReused: true,
            isCancelled: false,
            isAdditionalPlate: false,
            label: 'Plate Left Earlier'
          });
        }
      } else if (p.isAdditionalPlate) {
        res.push({
          plateId: p.plateId,
          count: p.count,
          rate: rateToUse,
          isJoint: false,
          plateRef: '',
          isReused: true,
          isCancelled: false,
          isAdditionalPlate: true,
          label: 'Additional Plate'
        });
      } else {
        res.push({
          plateId: p.plateId,
          count: p.count,
          rate: rateToUse,
          isJoint: false,
          plateRef: '',
          isReused: true,
          isCancelled: false,
          isAdditionalPlate: false,
          label: 'Original Plate'
        });
      }
    });
    return res;
  };

  const applyRepeatRefAndAutoDetect = (refCode: string, items = formData.selectedItems, plates = formData.platesUsed) => {
    const cleanRef = refCode.trim().toUpperCase().replace('#', '');
    const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
    
    let updatedPlates: any[] = [];
    let updatedItems = [...items];
    let clientNameUpdate = formData.clientName;
    let descUpdate = formData.jobDescription;
    let updatedProcessCharges = formData.processCharges;

    if (matchingJob) {
      if (!clientNameUpdate) clientNameUpdate = matchingJob.clientName;
      if (!descUpdate || descUpdate.startsWith('Repeat of')) descUpdate = `Repeat of ${matchingJob.jobDescription}`;

      // Auto-populate plates from the previous job and mark them as Reused
      if (matchingJob.platesUsed && matchingJob.platesUsed.length > 0) {
        updatedPlates = getCalculatedReusedPlates(matchingJob.platesUsed);
      }

      // Auto-populate paper stock items
      if (matchingJob.items && matchingJob.items.length > 0) {
        updatedItems = matchingJob.items.map((item) => {
          return {
            stockId: item.stockId || '',
            ups: item.ups || 1,
            quantityUsed: 0,
            allocatedPaper: 0,
            isJoint: false,
            paperRef: ''
          };
        });
      }

      // Copy process charges
      if (matchingJob.processCharges && matchingJob.processCharges.length > 0) {
        const defaults = getInitialProcessCharges();
        updatedProcessCharges = defaults.map(def => {
          const match = matchingJob.processCharges?.find(pc => pc.name.toLowerCase() === def.name.toLowerCase());
          return match ? { ...def, amount: match.amount, notes: match.notes || '' } : def;
        });
      }
    }

    setFormData({
      ...formData,
      isRepeat: true,
      repeatRef: refCode,
      clientName: clientNameUpdate,
      jobDescription: descUpdate,
      selectedItems: updatedItems,
      platesUsed: updatedPlates,
      processCharges: updatedProcessCharges
    } as any);

    if (matchingJob && cleanRef.length === 4) {
      toast.success(`Repeat connected to Job #${cleanRef}. Reused plates & paper specs loaded!`);
    }
  };

  const handleRepeatRefChange = (val: string) => {
    applyRepeatRefAndAutoDetect(val);
  };

  const handleJobTypeChange = (type: 'standard' | 'repeat' | 'joint') => {
    if (type === 'repeat') {
      const refValue = (formData as any).repeatRef || '';
      const updatedItems = formData.selectedItems.map(item => ({
        ...item,
        quantityUsed: 0,
        allocatedPaper: 0,
        isJoint: false,
        paperRef: ''
      }));
      setFormData({
        ...formData,
        isJoint: false,
        jointJobType: '',
        sharedRunId: '',
        jointParentId: '',
        jointRef: '',
        isRepeat: true,
        repeatRef: refValue,
        selectedItems: updatedItems
      } as any);
      if (refValue) {
        applyRepeatRefAndAutoDetect(refValue, updatedItems, formData.platesUsed);
      }
    } else if (type === 'joint') {
      const updatedItems = formData.selectedItems.map(item => ({
        ...item,
        isJoint: true,
        ups: item.ups || 1
      }));

      const updatedPlates = formData.platesUsed.map((p, idx) => ({
        ...p,
        isAdditionalPlate: idx > 0 ? true : false
      }));

      setFormData({
        ...formData,
        isJoint: true,
        jointJobType: 'master', // Default to Master Joint Job
        sharedRunId: '',
        jointParentId: '',
        jointRef: '',
        isRepeat: false,
        repeatRef: '',
        selectedItems: updatedItems,
        platesUsed: updatedPlates
      } as any);
    } else {
      const updatedItems = formData.selectedItems.map(item => ({
        ...item,
        isJoint: false,
        paperRef: '',
        ups: undefined
      }));
      setFormData({
        ...formData,
        isJoint: false,
        jointJobType: '',
        sharedRunId: '',
        jointParentId: '',
        jointRef: '',
        isRepeat: false,
        repeatRef: '',
        selectedItems: updatedItems,
        platesUsed: formData.platesUsed.map(p => ({
          ...p,
          isJoint: false,
          plateRef: '',
          isReused: false,
          isAdditionalPlate: false
        }))
      } as any);
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
        quantityUsed: matchingJob?.items?.[0]?.quantityUsed || firstItem?.quantityUsed || 0,
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

          if (p.isCancelled) {
            // Cancelled in parent -> make as regular newly made plate in repeat job
            return {
              plateId: p.plateId,
              count: p.count,
              rate: rateToUse,
              isJoint: false,
              plateRef: '',
              isReused: false,
              isCancelled: false
            };
          }

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
        paperRef: '',
        ups: undefined,
        calculatedSheets: undefined,
        autoCalculate: false
      }));
      setFormData({
        ...formData,
        isJoint: false,
        jointRef: '',
        selectedItems: updatedItems,
        platesUsed: getInitialPlatesUsed()
      } as any);
    }
  };

  const handleJointJobRefChange = (val: string) => {
    applyJointRefAndAutoDetect(val);
  };

  const handleSelectParentMasterJob = (masterJobId: string) => {
    if (masterJobId === "none" || !masterJobId) {
      setFormData({
        ...formData,
        jointParentId: '',
        sharedRunId: '',
        jointRef: ''
      } as any);
      return;
    }
    const mj = jobs.find(j => j.id === masterJobId);
    if (mj) {
      // Inherit Paper Stock, Paper Rate, Shared Print Run ID from Job A (Master)
      // but Matter Ups can be typed, and we display the master stock, rate.
      const masterItems = mj.items || [];
      const inheritedItems = masterItems.map(item => ({
        stockId: item.stockId,
        paperRate: item.paperRate || 0,
        ups: item.ups || 1, // default to parent's ups
        quantityUsed: item.quantityUsed || 0, // default to parent's sheets used
        wastageSheets: item.wastageSheets || 0, // default to parent's wastage sheets
        isJoint: true,
        paperRef: mj.id.slice(-4).toUpperCase()
      }));

      // Set plates used
      const masterPlates = mj.platesUsed || [];
      const inheritedPlates = masterPlates.map(p => ({
        ...p,
        isJoint: true,
        plateRef: mj.id.slice(-4).toUpperCase(),
        isReused: true // Reused since Master pays or shares plates
      }));

      const autoProdQty = inheritedItems.reduce((acc: number, item: any) => {
        return acc + (Number(item.quantityUsed || 0) * (Number(item.ups) || 1));
      }, 0);

      setFormData({
        ...formData,
        jointParentId: masterJobId,
        sharedRunId: mj.sharedRunId || '',
        jointRef: mj.id.slice(-4).toUpperCase(),
        selectedItems: inheritedItems,
        platesUsed: inheritedPlates,
        orderedQuantity: autoProdQty
      } as any);

      toast.success(`Inherited paper specs and shared run (${mj.sharedRunId || 'JR???'}) from Master.`);
    }
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...formData.selectedItems];
    let update: any = { [field]: value };
    
    const mergedItem = { ...newItems[index], ...update };
    
    // Auto-detect matching paper stock actual usage if this is a joint job and stock selection changes
    if ((formData as any).isJoint && (formData as any).jointRef && field === 'stockId' && value) {
      const cleanRef = (formData as any).jointRef.trim().toUpperCase().replace('#', '');
      const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
      if (matchingJob) {
        const matchingItem = matchingJob.items?.find((it: any) => it.stockId === value);
        if (matchingItem) {
          mergedItem.quantityUsed = matchingItem.quantityUsed;
          mergedItem.wastageSheets = matchingItem.wastageSheets || 0;
          const stockName = stocks.find(s => s.id === value)?.name || 'paper';
          toast.success(`Auto-detected ${matchingItem.quantityUsed} physical sheets and ${matchingItem.wastageSheets || 0} wastage from Job #${cleanRef}`);
        }
      }
    }

    // Auto populate defaultRate from selected stockId
    if (field === 'stockId' && value) {
      const selectedStock = stocks.find(s => s.id === value);
      if (selectedStock) {
        mergedItem.paperRate = selectedStock.defaultRate || 0;
      }
    }

    newItems[index] = mergedItem;

    const isJointJob = !!(formData as any).isJoint;
    let autoProdQty = formData.orderedQuantity;
    if (isJointJob) {
      autoProdQty = newItems.reduce((acc: number, item: any) => {
        return acc + (Number(item.quantityUsed || 0) * (Number(item.ups) || 1));
      }, 0);
    }

    const tempForm = { ...formData, selectedItems: newItems, orderedQuantity: autoProdQty };
    const finalItems = recalculateAllocatedPapersForForm(tempForm, jobs);
    setFormData({ ...tempForm, selectedItems: finalItems });
  };

  const handleAddPlate = () => {
    setFormData({
      ...formData,
      platesUsed: [
        ...formData.platesUsed,
        { plateId: '', count: 0, isJoint: false, plateRef: '', rate: 0, isAdditionalPlate: formData.isJoint ? true : false }
      ]
    });
  };

  const handleRemovePlate = (index: number) => {
    const newPlates = [...formData.platesUsed];
    newPlates.splice(index, 1);
    setFormData({ ...formData, platesUsed: newPlates });
  };

  const handleToggleCancelledColor = (index: number, color: string) => {
    const currentVal = formData.platesUsed[index]?.cancelledColor || '';
    const currentColors = currentVal ? currentVal.split('/') : [];
    let nextColors: string[];
    if (currentColors.includes(color)) {
      nextColors = currentColors.filter(c => c !== color);
    } else {
      const baseOrder = { C: 1, M: 2, Y: 3, K: 4 };
      nextColors = [...currentColors, color].sort((a, b) => {
        return (baseOrder[a as keyof typeof baseOrder] || 9) - (baseOrder[b as keyof typeof baseOrder] || 9);
      });
    }
    handlePlateChange(index, 'cancelledColor', nextColors.join('/'));
  };

  const handleAddReplacementPlate = (index: number) => {
    const origPlate = formData.platesUsed[index];
    if (!origPlate) return;
    setFormData({
      ...formData,
      platesUsed: [
        ...formData.platesUsed,
        {
          plateId: origPlate.plateId || '',
          count: origPlate.count || 0,
          rate: origPlate.rate || 0,
          isJoint: false,
          plateRef: '',
          isCancelled: false,
          cancelledColor: '',
          isAdditionalPlate: true
        }
      ]
    });
    toast.success('Added an additional plate corresponding to the cancelled plate!');
  };

  const handlePlateChange = (index: number, field: 'plateId' | 'count' | 'isJoint' | 'plateRef' | 'rate' | 'isReused' | 'isCancelled' | 'cancelledColor' | 'isAdditionalPlate', value: any) => {
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
    
    // Filter out completely untouched/empty default entries
    const cleanSelectedItems = formData.selectedItems.filter(item => !(item.stockId === '' && (item.quantityUsed === 0 || !item.quantityUsed)));
    const cleanPlatesUsed = formData.platesUsed.filter(p => !(p.plateId === '' && (p.count === 0 || !p.count)));

    if (cleanSelectedItems.length === 0 && cleanPlatesUsed.length === 0 && !formData.processCharges.some(pc => pc.amount > 0)) {
      toast.error('Please add at least one material stock, plate, or process charge to the job');
      return;
    }

    if (formData.isJoint) {
      if (cleanSelectedItems.length === 0) {
        toast.error('For joint jobs, specifying the paper required is compulsory');
        return;
      }
      for (const item of cleanSelectedItems) {
        if (!item.stockId) {
          toast.error('Please select a paper stock for all items');
          return;
        }
        if (!item.ups || item.ups <= 0) {
          toast.error('Matter Ups is required and must be greater than 0.');
          return;
        }
        if (item.quantityUsed === undefined || item.quantityUsed === null || item.quantityUsed <= 0) {
          // Allow reading or entering actual sheets used
          toast.error('Actual Sheets Used is required and must be greater than 0.');
          return;
        }
      }
      if (formData.jointJobType === 'linked' && !formData.jointRef) {
        toast.error('Please select a Joint Reference (Master Joint Job) first.');
        return;
      }
    } else {
      for (const item of cleanSelectedItems) {
        if (!item.stockId) {
          toast.error('Please select a paper stock for all items');
          return;
        }
      }
    }

    for (const plate of cleanPlatesUsed) {
      if (!plate.plateId && !plate.isJoint) {
        toast.error('Please select a plate model/size');
        return;
      }
    }

    const generateNextSharedRunId = (existingJobs: Job[]): string => {
      let maxNum = 0;
      existingJobs.forEach(job => {
        if (job.sharedRunId && job.sharedRunId.startsWith('JR')) {
          const numPart = job.sharedRunId.slice(2);
          const parsed = parseInt(numPart, 10);
          if (!isNaN(parsed) && parsed > maxNum) {
            maxNum = parsed;
          }
        }
      });
      const nextNum = maxNum + 1;
      return `JR${nextNum.toString().padStart(3, '0')}`;
    };

    try {
      await runTransaction(db, async (transaction) => {
        const isJobLinked = !!formData.isJoint && formData.jointJobType === 'linked';

        // 1. Generate sharedRunId sequentially for master joint job
        let finalSharedRunId = '';
        if (formData.isJoint) {
          if (formData.jointJobType === 'master') {
            finalSharedRunId = formData.sharedRunId || generateNextSharedRunId(jobs);
          } else if (formData.jointJobType === 'linked') {
            finalSharedRunId = formData.sharedRunId;
          }
        }

        // Allocate a new ID for the job in advance
        const jobsRef = collection(db, 'jobs');
        const newJobDoc = doc(jobsRef);
        const newJobId = newJobDoc.id;

        // Paper stock deduction (only Master deducts; Linked jobs bypass)
        const paperItemsToDeduct = isJobLinked 
          ? [] 
          : cleanSelectedItems.map(i => ({ 
              id: i.stockId, 
              used: Number(i.quantityUsed) + (Number(i.wastageSheets) || 0) 
            }));

        // Plates deduction:
        // - Additional plates ALWAYS deduct normally
        // - Shared plates ONLY deduct once, when saving the master/run
        const plateItemsToDeduct = cleanPlatesUsed
          .filter(p => (!p.isJoint || formData.jointJobType === 'master') && !p.isReused)
          .map(p => ({ 
            id: p.plateId, 
            used: Number(p.count) 
          }));

        const allItems = [
          ...paperItemsToDeduct,
          ...plateItemsToDeduct
        ].filter(item => item.id);

        const stockRefs = allItems.map(item => doc(db, 'stocks', item.id));
        const stockSnaps = stockRefs.length > 0
          ? await Promise.all(stockRefs.map(ref => transaction.get(ref)))
          : [];

        for (let i = 0; i < stockSnaps.length; i++) {
          const snap = stockSnaps[i];
          const item = allItems[i];
          if (!snap.exists()) throw new Error(`Stock ${item.id} not found`);
          const stockData = snap.data() as StockItem;
          if (stockData.quantity < item.used && !formData.ignoreStockLimits) {
            throw new Error(`Insufficient stock for ${stockData.name}. Available: ${stockData.quantity}`);
          }
        }

        let jobDateTimestamp = Date.now();
        if (formData.date) {
          const parsedDate = new Date(formData.date);
          const now = new Date();
          parsedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
          jobDateTimestamp = parsedDate.getTime();
        }

        // 2. Deduct stock and record history
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
            date: jobDateTimestamp,
            type: 'usage',
            quantity: -item.used,
            previousQuantity: stockData.quantity,
            newQuantity: newQuantity,
            notes: `Job created (stock deducted): ${formData.clientName} - ${formData.jobDescription}`
          });
        });

        // 3. Setup JointRun Document in Firestore
        if (formData.isJoint && finalSharedRunId) {
          const jointRunRef = doc(db, 'jointRuns', finalSharedRunId);
          const jointRunSnap = await transaction.get(jointRunRef);

          if (formData.jointJobType === 'master') {
            const paperStockId = cleanSelectedItems[0]?.stockId || '';
            const paperItemFromStock = stocks.find(s => s.id === paperStockId);
            const jointRunData: JointRun = {
              id: finalSharedRunId,
              sharedRunId: finalSharedRunId,
              paper: {
                stockId: paperStockId,
                paperSize: (formData as any).paperSize || paperItemFromStock?.size || '',
                paperSection: (formData as any).paperSection || paperItemFromStock?.paperType || '',
                paperNotes: (formData as any).paperNotes || '',
                productionNotes: (formData as any).productionNotes || '',
                paperRate: cleanSelectedItems[0]?.paperRate || 0
              },
              totalSheetsUsed: Number(cleanSelectedItems[0]?.quantityUsed) || 0,
              wastageSheets: Number(cleanSelectedItems[0]?.wastageSheets) || 0,
              sharedPlates: cleanPlatesUsed.filter(p => p.isJoint).map(p => ({
                plateId: p.plateId,
                count: Number(p.count),
                rate: Number(p.rate) || 0,
                isJoint: true,
                plateRef: finalSharedRunId
              })),
              linkedJobs: [newJobId]
            };
            transaction.set(jointRunRef, cleanUndefined(jointRunData));
          } else if (formData.jointJobType === 'linked') {
            if (jointRunSnap.exists()) {
              const jrData = jointRunSnap.data() as JointRun;
              const updatedLinkedJobs = Array.from(new Set([...(jrData.linkedJobs || []), newJobId]));
              transaction.update(jointRunRef, { linkedJobs: updatedLinkedJobs });
            }
          }
        }

        // 4. Create Job document in Firestore
        // Save only job-specific items/additional plates to avoid duplicating shared data in the database
        const jobDataToSave = {
          clientName: formData.clientName,
          jobDescription: formData.jobDescription,
          date: jobDateTimestamp,
          items: formData.isJoint
            ? cleanSelectedItems.map(item => ({ ups: item.ups, isJoint: true, paperRate: item.paperRate }))
            : cleanSelectedItems,
          platesUsed: formData.isJoint
            ? cleanPlatesUsed.filter(p => !p.isJoint)
            : cleanPlatesUsed,
          processCharges: formData.processCharges.filter(pc => pc.amount > 0 || (pc.notes && pc.notes.trim() !== '')),
          lamination: formData.lamination,
          orderedQuantity: formData.orderedQuantity ? Number(formData.orderedQuantity) : 0,
          dispatches: [],
          dispatchStatus: 'pending' as const,
          isJoint: !!formData.isJoint,
          jointJobType: formData.isJoint ? (formData.jointJobType || 'master') : undefined,
          sharedRunId: finalSharedRunId || undefined,
          jointRef: formData.isJoint ? (formData.jointRef || '') : '',
          isRepeat: !!formData.isRepeat,
          repeatRef: formData.isRepeat ? (formData.repeatRef || '') : '',
          paperBillingMethod: formData.paperBillingMethod || '',
          paperBillingRate: Number(formData.paperBillingRate) || 0,
          paperBillingAmount: Number(formData.paperBillingAmount) || 0,
          additionalCharges: Number(formData.additionalCharges) || 0
        };

        transaction.set(newJobDoc, cleanUndefined(jobDataToSave));
      });

      setIsAddOpen(false);
      setFormData({ clientName: '', jobDescription: '', selectedItems: getInitialSelectedItems(), platesUsed: getInitialPlatesUsed(), processCharges: getInitialProcessCharges(), lamination: getInitialLamination(), ignoreStockLimits: false, orderedQuantity: '', isJoint: false, jointJobType: '', sharedRunId: '', jointParentId: '', jointRef: '', isRepeat: false, repeatRef: '', date: new Date().toISOString().split('T')[0], paperBillingMethod: '', paperBillingRate: 0, paperBillingAmount: 0, additionalCharges: 0 } as any);
      toast.success('Job created and stock updated successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create job');
      console.error(error);
    }
  };

  const handleDeleteJob = async () => {
    if (!jobToDelete) return;

    if (jobToDelete.isJoint && jobToDelete.jointJobType === 'master') {
      const siblings = jobs.filter(j => j.sharedRunId === jobToDelete.sharedRunId && j.id !== jobToDelete.id);
      if (siblings.length > 0) {
        toast.error('Cannot delete Master Joint Job while other companion Linked Jobs are active. Please delete linked jobs first.');
        return;
      }
    }
    
    try {
      await runTransaction(db, async (transaction) => {
        const isLinkedJob = !!jobToDelete.isJoint && jobToDelete.jointJobType === 'linked';
        
        let paperItemsToReturn = isLinkedJob 
          ? [] 
          : jobToDelete.items.map(i => ({ 
              id: i.stockId, 
              used: Number(i.quantityUsed) + (Number(i.wastageSheets) || 0) 
            }));

        const plateItemsToReturn = (jobToDelete.platesUsed || [])
          .filter(p => !p.isJoint && !p.isReused)
          .map(p => ({ id: p.plateId, used: p.count }));

        let runToDeleteRef = null;

        if (jobToDelete.isJoint && jobToDelete.sharedRunId) {
          const runId = jobToDelete.sharedRunId;
          const runRef = doc(db, 'jointRuns', runId);
          const runSnap = await transaction.get(runRef);
          
          if (runSnap.exists()) {
            const runData = runSnap.data() as JointRun;
            const updatedLinked = (runData.linkedJobs || []).filter(id => id !== jobToDelete.id);
            
            if (isLinkedJob && updatedLinked.length > 0) {
              transaction.update(runRef, { linkedJobs: updatedLinked });
            } else {
              runToDeleteRef = runRef;
              // Return run-level paper resources if we are deleting the last job in this run
              if (runData.paper?.stockId) {
                const qty = Number(runData.totalSheetsUsed || 0) + Number(runData.wastageSheets || 0);
                if (qty > 0) {
                  paperItemsToReturn.push({ id: runData.paper.stockId, used: qty });
                }
              }
              // Return run-level plates as well
              (runData.sharedPlates || []).forEach(p => {
                paperItemsToReturn.push({ id: p.plateId, used: Number(p.count || 0) });
              });
            }
          }
        }

        const allItems = [
          ...paperItemsToReturn,
          ...plateItemsToReturn
        ].filter(item => item.id);

        const stockRefs = allItems.map(item => doc(db, 'stocks', item.id));
        const stockSnaps = stockRefs.length > 0 
          ? await Promise.all(stockRefs.map(ref => transaction.get(ref)))
          : [];
        
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
              notes: `Job deleted and stock returned: ${jobToDelete.clientName} - ${jobToDelete.jobDescription}`
            });
          }
        });
        
        if (runToDeleteRef) {
          transaction.delete(runToDeleteRef);
        }

        transaction.delete(doc(db, 'jobs', jobToDelete.id));
      });
      setJobToDelete(null);
      toast.success('Job deleted and associated stock returned successfully');
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
          materialsUsed.push(`${stockItem.name}: ${(item.quantityUsed ?? 0).toLocaleString()} ${unitLabel}`);
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

    // Filter out completely untouched/empty default entries
    const cleanSelectedItems = formData.selectedItems.filter(item => !(item.stockId === '' && (item.quantityUsed === 0 || !item.quantityUsed)));
    const cleanPlatesUsed = formData.platesUsed.filter(p => !(p.plateId === '' && (p.count === 0 || !p.count)));

    if (cleanSelectedItems.length === 0 && cleanPlatesUsed.length === 0 && !formData.processCharges.some(pc => pc.amount > 0)) {
      toast.error('Please add at least one material stock, plate, or process charge to the job');
      return;
    }

    if (formData.isJoint) {
      if (cleanSelectedItems.length === 0) {
        toast.error('For joint jobs, specifying the paper required is compulsory');
        return;
      }
      for (const item of cleanSelectedItems) {
        if (!item.stockId) {
          toast.error('Please select a paper stock for all items');
          return;
        }
        if (!item.ups || item.ups <= 0) {
          toast.error('Matter Ups is required and must be greater than 0.');
          return;
        }
        if (item.quantityUsed === undefined || item.quantityUsed === null || item.quantityUsed <= 0) {
          toast.error('Actual Sheets Used is required and must be greater than 0.');
          return;
        }
      }
      if (formData.jointJobType === 'linked' && !formData.jointRef) {
        toast.error('Please select a Joint Reference (Master Joint Job) first.');
        return;
      }
    } else {
      for (const item of cleanSelectedItems) {
        if (!item.stockId) {
          toast.error('Please select a paper stock for all items');
          return;
        }
      }
    }

    for (const plate of cleanPlatesUsed) {
      if (!plate.plateId && !plate.isJoint) {
        toast.error('Please select a plate model/size');
        return;
      }
    }

    const generateNextSharedRunId = (existingJobs: Job[]): string => {
      let maxNum = 0;
      existingJobs.forEach(job => {
        if (job.sharedRunId && job.sharedRunId.startsWith('JR')) {
          const numPart = job.sharedRunId.slice(2);
          const parsed = parseInt(numPart, 10);
          if (!isNaN(parsed) && parsed > maxNum) {
            maxNum = parsed;
          }
        }
      });
      const nextNum = maxNum + 1;
      return `JR${nextNum.toString().padStart(3, '0')}`;
    };

    try {
      const siblingJobsQuery = query(collection(db, 'jobs'), where('sharedRunId', '==', formData.sharedRunId || ''));
      const siblingJobsSnap = (formData.isJoint && formData.jointJobType === 'master' && formData.sharedRunId) 
        ? await getDocs(siblingJobsQuery) 
        : null;
      
      const siblingJobs = siblingJobsSnap 
        ? siblingJobsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job)).filter(j => j.id !== editingJob.id)
        : [];

      await runTransaction(db, async (transaction) => {
        let finalSharedRunId = '';
        if (formData.isJoint) {
          if (formData.jointJobType === 'master') {
            finalSharedRunId = formData.sharedRunId || generateNextSharedRunId(jobs);
          } else if (formData.jointJobType === 'linked') {
            finalSharedRunId = formData.sharedRunId;
          }
        }

        const jrRef = finalSharedRunId ? doc(db, 'jointRuns', finalSharedRunId) : null;
        const jrSnap = jrRef ? await transaction.get(jrRef) : null;
        const oldJrData = jrSnap && jrSnap.exists() ? jrSnap.data() as JointRun : null;

        const isOldJobMaster = !!editingJob.isJoint && editingJob.jointJobType === 'master';
        const isOldJobLinked = !!editingJob.isJoint && editingJob.jointJobType === 'linked';
        const isNewJobMaster = !!formData.isJoint && formData.jointJobType === 'master';
        const isNewJobLinked = !!formData.isJoint && formData.jointJobType === 'linked';

        const stockChanges = new Map<string, number>();

        // 1. Add back old paper if the old state did NOT bypass paper deduction (i.e. not old linked)
        if (!isOldJobLinked) {
          editingJob.items.forEach(it => {
            if (it.stockId) {
              const qty = Number(it.quantityUsed || 0) + (Number(it.wastageSheets || 0));
              stockChanges.set(it.stockId, (stockChanges.get(it.stockId) || 0) + qty);
            }
          });
        }

        // 2. Deduct new paper if the new state does NOT bypass paper deduction (i.e. not new linked)
        if (!isNewJobLinked) {
          cleanSelectedItems.forEach(it => {
            if (it.stockId) {
              const qty = Number(it.quantityUsed || 0) + (Number(it.wastageSheets || 0));
              stockChanges.set(it.stockId, (stockChanges.get(it.stockId) || 0) - qty);
            }
          });
        }

        // 3. Add back old individual plates of the job
        const oldIndividualPlates = (editingJob.platesUsed || []).filter(p => !p.isJoint && !p.isReused);
        oldIndividualPlates.forEach(p => {
          stockChanges.set(p.plateId, (stockChanges.get(p.plateId) || 0) + Number(p.count || 0));
        });

        // 4. Deduct new individual plates of the job
        const newIndividualPlates = cleanPlatesUsed.filter(p => !p.isJoint && !p.isReused);
        newIndividualPlates.forEach(p => {
          stockChanges.set(p.plateId, (stockChanges.get(p.plateId) || 0) - Number(p.count || 0));
        });

        // 5. Add back old shared plates at the RUN level if we were the master
        if (isOldJobMaster && oldJrData) {
          (oldJrData.sharedPlates || []).forEach(p => {
            stockChanges.set(p.plateId, (stockChanges.get(p.plateId) || 0) + Number(p.count || 0));
          });
        }

        // 6. Deduct new shared plates at the RUN level if we are now the master
        if (isNewJobMaster) {
          cleanPlatesUsed.filter(p => p.isJoint && !p.isReused).forEach(p => {
            stockChanges.set(p.plateId, (stockChanges.get(p.plateId) || 0) - Number(p.count || 0));
          });
        }

        // Validate stock changes and write to database transactionally
        const uniqueChangedIds = Array.from(stockChanges.keys()).filter(id => id && stockChanges.get(id) !== 0);
        const stockRefs = uniqueChangedIds.map(id => doc(db, 'stocks', id));
        const stockSnaps = stockRefs.length > 0 ? await Promise.all(stockRefs.map(ref => transaction.get(ref))) : [];

        for (let i = 0; i < stockSnaps.length; i++) {
          const snap = stockSnaps[i];
          const stockId = uniqueChangedIds[i];
          const change = stockChanges.get(stockId) || 0;
          if (!snap.exists()) continue;
          const stockData = snap.data() as StockItem;
          const finalQuantity = stockData.quantity + change;

          if (finalQuantity < 0 && !formData.ignoreStockLimits) {
            throw new Error(`Insufficient stock for ${stockData.name}. Available: ${stockData.quantity + (change < 0 ? -change : 0)}`);
          }

          transaction.update(snap.ref, {
            quantity: finalQuantity,
            lastUpdated: Date.now()
          });

          if (change !== 0) {
            const historyRef = doc(collection(db, 'stockHistory'));
            transaction.set(historyRef, {
              stockId: stockId,
              date: Date.now(),
              type: change > 0 ? 'addition' : 'usage',
              quantity: change,
              previousQuantity: stockData.quantity,
              newQuantity: finalQuantity,
              notes: `Job updated: ${formData.clientName} - ${formData.jobDescription}`
            });
          }
        }

        // 7. Sync or setup JointRun document in Firestore
        if (formData.isJoint && finalSharedRunId && jrRef) {
          const currentLinkedJobs = oldJrData ? (oldJrData.linkedJobs || []) : [editingJob.id];
          const paperStockId = cleanSelectedItems[0]?.stockId || (oldJrData?.paper?.stockId || '');
          const paperItemFromStock = stocks.find(s => s.id === paperStockId);

          const updatedJrData: JointRun = {
            id: finalSharedRunId,
            sharedRunId: finalSharedRunId,
            paper: {
              stockId: paperStockId,
              paperSize: (formData as any).paperSize || paperItemFromStock?.size || oldJrData?.paper?.paperSize || '',
              paperSection: (formData as any).paperSection || paperItemFromStock?.paperType || oldJrData?.paper?.paperSection || '',
              paperNotes: (formData as any).paperNotes || oldJrData?.paper?.paperNotes || '',
              productionNotes: (formData as any).productionNotes || oldJrData?.paper?.productionNotes || '',
              paperRate: cleanSelectedItems[0]?.paperRate || oldJrData?.paper?.paperRate || 0
            },
            totalSheetsUsed: Number(cleanSelectedItems[0]?.quantityUsed) || oldJrData?.totalSheetsUsed || 0,
            wastageSheets: Number(cleanSelectedItems[0]?.wastageSheets) || oldJrData?.wastageSheets || 0,
            sharedPlates: cleanPlatesUsed.filter(p => p.isJoint).map(p => ({
              plateId: p.plateId,
              count: Number(p.count),
              rate: Number(p.rate) || 0,
              isJoint: true,
              plateRef: finalSharedRunId
            })),
            linkedJobs: Array.from(new Set([...currentLinkedJobs, editingJob.id]))
          };

          // Compare changes and report audit logs in Firestore
          if (oldJrData && finalSharedRunId) {
            const checkAndLogChange = (fieldName: string, oldVal: any, newVal: any) => {
              if (oldVal !== newVal) {
                const auditLogRef = doc(collection(db, 'jointRunAuditLogs'));
                transaction.set(auditLogRef, {
                  sharedRunId: finalSharedRunId,
                  userEmail: auth.currentUser?.email || 'system',
                  changedField: fieldName,
                  oldValue: String(oldVal),
                  newValue: String(newVal),
                  affectedJobs: currentLinkedJobs,
                  timestamp: Date.now()
                });
              }
            };

            checkAndLogChange('Paper Stock', oldJrData.paper?.stockId, updatedJrData.paper?.stockId);
            checkAndLogChange('Paper Size', oldJrData.paper?.paperSize, updatedJrData.paper?.paperSize);
            checkAndLogChange('Paper Section', oldJrData.paper?.paperSection, updatedJrData.paper?.paperSection);
            checkAndLogChange('Shared Paper Notes', oldJrData.paper?.paperNotes, updatedJrData.paper?.paperNotes);
            checkAndLogChange('Shared Production Notes', oldJrData.paper?.productionNotes, updatedJrData.paper?.productionNotes);
            checkAndLogChange('Paper Rate', oldJrData.paper?.paperRate, updatedJrData.paper?.paperRate);
            checkAndLogChange('Total Sheets Used', oldJrData.totalSheetsUsed, updatedJrData.totalSheetsUsed);
            checkAndLogChange('Wastage Sheets', oldJrData.wastageSheets, updatedJrData.wastageSheets);

            const oldPlatesStr = (oldJrData.sharedPlates || []).map(p => `${p.plateId}:${p.count}`).join(', ');
            const newPlatesStr = (updatedJrData.sharedPlates || []).map(p => `${p.plateId}:${p.count}`).join(', ');
            checkAndLogChange('Shared Plates', oldPlatesStr, newPlatesStr);
          }

          transaction.set(jrRef, cleanUndefined(updatedJrData));

          // Cascading updates to linked sibling jobs in the same group to maintain alignment write-back
          siblingJobs.forEach(sib => {
            const sibItems = (sib.items || []).map((sibItem: any) => {
              return {
                ...sibItem,
                stockId: paperStockId,
                paperRate: Number(updatedJrData.paper?.paperRate) || 0,
                quantityUsed: Number(updatedJrData.totalSheetsUsed) || 0,
                wastageSheets: Number(updatedJrData.wastageSheets) || 0,
                isJoint: true,
                paperRef: finalSharedRunId
              };
            });

            const sibNonJointPlates = (sib.platesUsed || []).filter((p: any) => !p.isJoint);
            const sibSharedPlates = (updatedJrData.sharedPlates || []).map((p: any) => ({
              ...p,
              isJoint: true,
              plateRef: finalSharedRunId
            }));
            const sibPlates = [...sibSharedPlates, ...sibNonJointPlates];

            const sibOrderedQty = sibItems.reduce((acc: number, item: any) => {
              return acc + (Number(item.quantityUsed || 0) * (Number(item.ups) || 1));
            }, 0);

            transaction.update(doc(db, 'jobs', sib.id), cleanUndefined({
              items: sibItems.map(item => ({ ups: item.ups, isJoint: true, paperRate: item.paperRate })),
              platesUsed: sibNonJointPlates,
              orderedQuantity: sibOrderedQty
            }) as any);
          });
        }

        // 8. Update job record itself
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

        const jobDataToSave = {
          clientName: formData.clientName,
          jobDescription: formData.jobDescription,
          items: formData.isJoint
            ? cleanSelectedItems.map(item => ({ ups: item.ups, isJoint: true, paperRate: item.paperRate }))
            : cleanSelectedItems,
          platesUsed: formData.isJoint
            ? cleanPlatesUsed.filter(p => !p.isJoint)
            : cleanPlatesUsed,
          processCharges: formData.processCharges.filter(pc => pc.amount > 0 || (pc.notes && pc.notes.trim() !== '')),
          lamination: formData.lamination,
          orderedQuantity: orderedQty,
          dispatchStatus: status,
          isJoint: !!formData.isJoint,
          jointJobType: formData.isJoint ? (formData.jointJobType || 'master') : undefined,
          sharedRunId: finalSharedRunId || undefined,
          jointRef: formData.isJoint ? (formData.jointRef || '') : '',
          isRepeat: !!formData.isRepeat,
          repeatRef: formData.isRepeat ? (formData.repeatRef || '') : '',
          date: formData.date ? new Date(formData.date).getTime() : Date.now(),
          paperBillingMethod: formData.paperBillingMethod || '',
          paperBillingRate: Number(formData.paperBillingRate) || 0,
          paperBillingAmount: Number(formData.paperBillingAmount) || 0,
          additionalCharges: Number(formData.additionalCharges) || 0
        };

        transaction.update(doc(db, 'jobs', editingJob.id), cleanUndefined(jobDataToSave) as any);
      });

      setEditingJob(null);
      setFormData({ clientName: '', jobDescription: '', selectedItems: getInitialSelectedItems(), platesUsed: getInitialPlatesUsed(), processCharges: getInitialProcessCharges(), lamination: getInitialLamination(), ignoreStockLimits: false, orderedQuantity: '', isJoint: false, jointJobType: '', sharedRunId: '', jointParentId: '', jointRef: '', isRepeat: false, repeatRef: '', date: new Date().toISOString().split('T')[0], paperBillingMethod: '', paperBillingRate: 0, paperBillingAmount: 0, additionalCharges: 0 } as any);
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
          <Button
            variant="outline"
            className="border-amber-200 text-amber-700 hover:bg-amber-50 rounded-full h-12 md:h-10 px-4 flex items-center justify-center gap-2 w-full sm:w-auto shrink-0 font-medium"
            onClick={() => setIsAuditLogsOpen(true)}
          >
            <FileText size={16} />
            <span>Joint Run Audit Logs</span>
          </Button>
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
              selectedItems: getInitialSelectedItems(),
              platesUsed: getInitialPlatesUsed(),
              processCharges: getInitialProcessCharges(),
              lamination: getInitialLamination(),
              ignoreStockLimits: false,
              orderedQuantity: '',
              isJoint: false,
              jointRef: '',
              isRepeat: false,
              repeatRef: '',
              paperBillingMethod: '',
              paperBillingRate: 0,
              paperBillingAmount: 0,
              additionalCharges: 0
            } as any);
          }
        }}>
          <DialogTrigger render={
            <Button className="bg-[#5A5A40] hover:bg-[#4A4A30] rounded-full px-6 w-full sm:w-auto h-12 md:h-10">
              <Plus className="mr-2 h-4 w-4" /> Create New Job
            </Button>
          } />
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Job</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddJob} className="space-y-6 py-4">
              {/* UNIQUE_ADD_FORM_MARKER */}
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <span className="text-xs text-gray-400 font-medium font-mono uppercase tracking-widest">Job Setup</span>
                  <div className="flex items-center gap-1.5 bg-gray-50/50 px-2.5 py-1 rounded-xl border border-gray-100 shadow-3xs">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date:</span>
                    <input 
                      type="date" 
                      id="jobDate" 
                      value={formData.date || ''} 
                      onChange={e => setFormData({...formData, date: e.target.value})} 
                      required 
                      className="bg-transparent text-[11px] text-gray-700 font-bold focus:outline-hidden w-[105px] h-auto p-0 border-0 cursor-pointer" 
                    />
                  </div>
                </div>

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
                <div className="space-y-3 p-4 bg-gray-50 rounded-2xl border border-gray-200 mt-3 shadow-xs">
                  <Label className="text-xs uppercase tracking-widest text-[#5A5A40] font-bold">Job Link Workflow / Relationship</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleJobTypeChange('standard')}
                      className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                        !formData.isJoint && !formData.isRepeat
                          ? 'bg-[#5A5A40] text-white border-[#5A5A40] shadow-sm font-bold'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      Standard Job
                    </button>
                    <button
                      type="button"
                      onClick={() => handleJobTypeChange('repeat')}
                      className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                        formData.isRepeat
                          ? 'bg-[#5F7A61] text-white border-[#5F7A61] shadow-sm font-bold'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      Repeat Job
                    </button>
                    <button
                      type="button"
                      onClick={() => handleJobTypeChange('joint')}
                      className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                        formData.isJoint
                          ? 'bg-amber-700 text-white border-amber-700 shadow-sm font-bold'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      Joint Job
                    </button>
                  </div>

                  {/* If Repeat Job is selected */}
                  {formData.isRepeat && (
                    <div className="space-y-1 pt-2 animate-fadeIn transition-all">
                      <Label className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1">
                        <span>Select Previous Job ID</span>
                        <span className="text-red-500 font-bold">*</span>
                      </Label>
                      <Input 
                        type="text" 
                        placeholder="Previous Job Code to repeat/reuse plates (e.g. A3B8)" 
                        list="active-jobs-list"
                        value={(formData as any).repeatRef || ''} 
                        onChange={e => handleRepeatRefChange(e.target.value)}
                        className="bg-white h-10 text-xs rounded-xl font-mono uppercase border-gray-200 focus-visible:ring-[#5F7A61]"
                      />
                    </div>
                  )}

                  {/* If Joint Job is selected */}
                  {formData.isJoint && (
                    <div className="space-y-4 pt-3 border-t border-dashed border-gray-200 mt-2 animate-fadeIn">
                      <Label className="text-xs font-bold text-gray-500 uppercase">Joint Job Type Selection</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              jointJobType: 'master',
                              jointRef: '',
                              jointParentId: '',
                              sharedRunId: ''
                            } as any);
                          }}
                          className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                            formData.jointJobType === 'master'
                              ? 'bg-[#5A5A40] text-white border-[#5A5A40] shadow-sm font-bold'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          Master Joint Job (Job A)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              jointJobType: 'linked',
                              jointRef: '',
                              jointParentId: '',
                              sharedRunId: '',
                              selectedItems: getInitialSelectedItems()
                            } as any);
                          }}
                          className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                            formData.jointJobType === 'linked'
                              ? 'bg-amber-700 text-white border-amber-700 shadow-sm font-bold'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          Linked Joint Job (Job B)
                        </button>
                      </div>

                      {formData.jointJobType === 'master' && (
                        <div className="p-3 bg-amber-50/50 border border-amber-100/70 rounded-xl space-y-1">
                          <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Master Joint Run</span>
                          <span className="text-xs text-amber-700 font-medium">
                            💎 Registered Run: <strong className="font-mono text-amber-900">{formData.sharedRunId || 'JR??? (Will generate on save)'}</strong>
                          </span>
                          <span className="block text-[10px] text-amber-600/85">Paper stock deduction happens only from this Master run. Linked jobs will share and allocate automatically.</span>
                        </div>
                      )}

                      {formData.jointJobType === 'linked' && (
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
                              <span>Joint Reference (Master Joint Job)</span>
                              <span className="text-red-500 font-bold">*</span>
                            </Label>
                            
                            <Select 
                              value={formData.jointParentId || ''} 
                              onValueChange={(val) => handleSelectParentMasterJob(val)}
                            >
                              <SelectTrigger className="w-full bg-white border-gray-200 h-10 rounded-xl text-xs">
                                <SelectValue placeholder="Search Existing Master Joint Job..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {jobs.filter(j => j.isJoint && j.jointJobType === 'master').length === 0 ? (
                                    <SelectItem value="none" disabled>No Master Joint Jobs found. Create a Master job first.</SelectItem>
                                  ) : (
                                    jobs.filter(j => j.isJoint && j.jointJobType === 'master').map(mj => (
                                      <SelectItem key={mj.id} value={mj.id}>
                                        {mj.sharedRunId || 'JR???'} - {mj.clientName} ({mj.jobDescription}) [code: #{mj.id.slice(-4).toUpperCase()}]
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </div>

                          {formData.jointParentId && (
                            <div className="p-3 bg-green-50/50 border border-green-100/75 rounded-xl space-y-1">
                              <span className="text-[10px] font-bold text-green-800 uppercase tracking-wider block">Status</span>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-green-700 font-medium font-serif font-sans">
                                <span className="flex items-center gap-1">
                                  ✓ Shared Run ({formData.sharedRunId || 'Pending'})
                                </span>
                                <span className="flex items-center gap-1">
                                  ✓ Paper Shared
                                </span>
                                <span className="flex items-center gap-1">
                                  ✓ Allocation Calculated
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {formData.isRepeat && (
                <div className="p-5 bg-emerald-50/50 rounded-2xl border border-emerald-100/70 space-y-4 mb-3">
                  <h4 className="font-serif text-sm font-semibold text-emerald-950 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                    Repeat Job Configuration
                  </h4>
                  <p className="text-xs text-emerald-900 leading-relaxed">
                    Plates are reused automatically from previous job{' '}
                    <span className="font-mono font-extrabold bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-950 border border-emerald-200 shadow-sm">
                      #{formData.repeatRef ? formData.repeatRef.toUpperCase() : '????'}
                    </span>. Plate stock will <span className="font-bold text-emerald-700">not</span> be deducted.
                  </p>
                  
                  {(() => {
                    const cleanRef = (formData.repeatRef || '').trim().toUpperCase().replace('#', '');
                    const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                    return (
                      <div className="text-xs bg-white p-4 rounded-xl border border-gray-100/80 space-y-2.5">
                        {matchingJob ? (
                          <div className="space-y-3">
                            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                              <span className="text-gray-500 font-medium font-serif">Referenced Print Job:</span>
                              <span className="font-semibold text-gray-900 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200 text-slate-800">
                                Job #{cleanRef} ({matchingJob.clientName})
                              </span>
                            </div>
                            
                            {/* Detected Plates */}
                            {(() => {
                              const platesToDisplay = getCalculatedReusedPlates(matchingJob.platesUsed);

                              return platesToDisplay.length > 0 ? (
                                <div className="space-y-1.5 pt-2">
                                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Auto-detected Reused Plates:</span>
                                  {platesToDisplay.map((p, idx) => {
                                    const stock = stocks.find(s => s.id === p.plateId);
                                    return (
                                      <div key={idx} className="flex justify-between items-center text-[11px] bg-emerald-50/30 px-2.5 py-1.5 rounded-lg border border-emerald-100/30">
                                        <div className="flex flex-col gap-0.5">
                                          <span className="font-semibold text-emerald-950">{stock?.name || 'Plate'}</span>
                                          {p.label && (
                                            <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded leading-none w-fit ${
                                              p.label === 'Plate Left Earlier' ? 'bg-amber-100 text-amber-800' :
                                              p.label === 'Additional Plate' ? 'bg-pink-100 text-pink-800' :
                                              'bg-emerald-100 text-emerald-800'
                                            }`}>
                                              {p.label}
                                            </span>
                                          )}
                                        </div>
                                        <span className="font-mono bg-emerald-100/20 px-2.5 py-1 rounded text-emerald-800 font-bold">{p.count} plates (Reused)</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-[11px] text-gray-500 italic pt-1.5 border-t border-gray-100">
                                  No plates detected in the referenced job.
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div className="text-gray-400 italic text-center py-2 font-serif">
                            {formData.repeatRef ? 'Searching / Loading referenced job details...' : 'Please enter a valid four-digit job code above'}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="text-lg font-serif">Papers Used</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddItem} className="rounded-full">
                    <Plus className="mr-1 h-3 w-3" /> Add Paper
                  </Button>
                </div>
                
                {formData.selectedItems.map((item, index) => { /* ADD_FORM_EXCLUSIVE */
                  const isLinkedJob = !!(formData.isJoint && formData.jointJobType === 'linked');
                  return (
                    <div key={index} className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-4 relative">
                      <div className="absolute top-4 right-4 animate-fadeIn">
                        {!isLinkedJob && (
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleRemoveItem(index)} 
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full h-8 px-2"
                          >
                            Remove Paper
                          </Button>
                        )}
                      </div>

                      <h4 className="font-serif text-sm font-semibold text-gray-700">Paper Item #{index + 1}</h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                        {/* Paper Stock */}
                        <div className="md:col-span-6 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Select Paper Stock</Label>
                          {isLinkedJob ? (
                            <Input 
                              value={stocks.find(s => s.id === item.stockId)?.name || 'Matching Parent Stock'} 
                              readOnly 
                              className="bg-gray-100 border-gray-200 h-9 cursor-not-allowed text-gray-600 font-medium"
                            />
                          ) : (
                            <StockSelect 
                              value={item.stockId} 
                              onValueChange={(v) => handleItemChange(index, 'stockId', v)}
                              stocks={stocks}
                              type="paper"
                              placeholder="Choose paper..."
                            />
                          )}
                        </div>

                        {/* Matter Ups */}
                        <div className="md:col-span-6 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Matter Ups</Label>
                          <Input 
                            type="number" 
                            placeholder="e.g. 1"
                            value={item.ups || ''} 
                            onChange={e => handleItemChange(index, 'ups', e.target.value === '' ? undefined : Number(e.target.value))} 
                            onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                            className="bg-gray-50 border-gray-200 h-9"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-gray-100">
                        {/* Total Sheets Used */}
                        <div className="md:col-span-4 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">
                            {formData.isJoint ? "Total Sheets Used" : "Actual Sheets Used"}
                          </Label>
                          <Input 
                            type="number" 
                            value={item.quantityUsed === 0 ? '' : item.quantityUsed} 
                            onChange={e => handleItemChange(index, 'quantityUsed', e.target.value === '' ? 0 : Number(e.target.value))} 
                            onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                            required
                            readOnly={isLinkedJob}
                            placeholder={isLinkedJob ? "Linked from parent" : "sheets"}
                            className={`${isLinkedJob ? "bg-gray-100 cursor-not-allowed text-gray-600 font-medium" : "bg-gray-50"} border-gray-200 h-9`}
                          />
                        </div>

                        {/* Wastage Sheets */}
                        <div className="md:col-span-4 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Wastage Sheets</Label>
                          <Input 
                            type="number" 
                            value={item.wastageSheets === undefined ? 0 : item.wastageSheets} 
                            onChange={e => handleItemChange(index, 'wastageSheets', e.target.value === '' ? 0 : Number(e.target.value))} 
                            onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                            readOnly={isLinkedJob}
                            placeholder={isLinkedJob ? "Linked from parent" : "sheets"}
                            className={`${isLinkedJob ? "bg-gray-100 cursor-not-allowed text-gray-600 font-medium" : "bg-gray-50"} border-gray-200 h-9`}
                          />
                        </div>

                        {/* Allocated Paper */}
                        <div className="md:col-span-4 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Allocated Paper</Label>
                          <Input 
                            value={(item.allocatedPaper || 0).toLocaleString()}
                            readOnly
                            placeholder="Auto Calculated"
                            className="bg-green-50 border-green-200 h-9 font-semibold text-green-700 cursor-default"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-gray-100">
                        {/* Produced Quantity */}
                        <div className="md:col-span-12 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Produced Quantity (Read Only)</Label>
                          <Input 
                            value={((item.allocatedPaper !== undefined ? item.allocatedPaper : (item.quantityUsed || 0)) * (item.ups || 1)).toLocaleString()}
                            readOnly
                            placeholder="Sheets × Ups"
                            className="bg-blue-50 border-blue-200 h-9 font-semibold text-blue-700 cursor-default"
                          />
                        </div>
                      </div>
                      
                      {isLinkedJob && item.paperRef && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 md:bg-amber-50/70 border border-amber-100 text-[11px] text-amber-800 rounded-lg animate-fadeIn">
                          <span className="font-semibold font-mono bg-amber-200/60 px-1 py-0.5 rounded">Joint Job Reference: #{item.paperRef}</span>
                          <span>(Paper Stock and Rate inherited automatically from Parent Master Job)</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

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
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <Label className="text-xs font-semibold text-gray-700">Select Plate</Label>
                          {plate.isAdditionalPlate && (
                            <Badge className="bg-pink-500 hover:bg-pink-600 border-none text-white text-[9px] h-4 px-1.5 leading-none uppercase tracking-wider font-bold">
                              Additional Plate
                            </Badge>
                          )}
                        </div>
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

                    {/* Cancelled checkbox in Add Form */}
                    <div className="col-span-12 flex flex-wrap gap-4 pt-2 border-t border-gray-100/60 mt-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`plate-cancelled-${index}`}
                          checked={!!plate.isCancelled}
                          onChange={e => {
                            const val = e.target.checked;
                            handlePlateChange(index, 'isCancelled', val);
                            if (val && !plate.cancelledColor) {
                              handlePlateChange(index, 'cancelledColor', 'C');
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-red-550 focus:ring-0 cursor-pointer"
                        />
                        <Label htmlFor={`plate-cancelled-${index}`} className="text-xs text-red-600 font-semibold select-none cursor-pointer">
                          Cancelled for Future Repeat (Retired Plate - Client is Charged)
                        </Label>
                      </div>
                    </div>

                    {plate.isCancelled && (
                      <div className="col-span-12 space-y-3 px-4 py-3 bg-red-50/50 border border-red-200/50 rounded-2xl mt-1.5 animate-fadeIn">
                        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1">
                            <span className="text-xs font-bold text-red-800 block">Choose Cancelled Color Channel(s):</span>
                            <span className="text-[10px] text-red-600 block leading-tight">Select all colors that apply to this retired/spoiled plate block.</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(['C', 'M', 'Y', 'K'] as const).map(color => {
                              const isSelected = (plate.cancelledColor || '').split('/').includes(color);
                              return (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => handleToggleCancelledColor(index, color)}
                                  className={`h-7 px-3 text-xs font-extrabold rounded-lg border transition-all cursor-pointer ${
                                    isSelected
                                      ? 'bg-red-600 text-white border-red-600 shadow-xs font-bold'
                                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  {color}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="pt-2 border-t border-red-200/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                          <span className="text-xs text-red-700 font-medium">Need to add another plate to compensate for this cancelled one?</span>
                          <button
                            type="button"
                            onClick={() => handleAddReplacementPlate(index)}
                            className="bg-red-600/15 hover:bg-red-600/25 text-red-800 text-xs font-bold py-1.5 px-3.5 rounded-xl border border-red-200 transition-all flex items-center gap-1.5 shadow-xs w-fit cursor-pointer"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                            Add Additional Plate Used
                          </button>
                        </div>
                      </div>
                    )}

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

              {/* Lamination Options Section inside Add Modal */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center">
                  <Label className="text-lg font-serif">Lamination Details</Label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Half Lamination Card */}
                  <div className={`p-4 rounded-2xl border transition-all ${formData.lamination?.halfEnabled ? 'bg-amber-50/30 border-amber-200/60' : 'bg-gray-50 border-gray-150'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="checkbox"
                        id="add-lamination-halfEnabled"
                        checked={!!formData.lamination?.halfEnabled}
                        onChange={e => setFormData({
                          ...formData,
                          lamination: {
                            ...(formData.lamination || getInitialLamination()),
                            halfEnabled: e.target.checked,
                            halfQty: e.target.checked ? (formData.lamination?.halfQty || Number(formData.orderedQuantity) || 0) : 0
                          }
                        })}
                        className="h-4 w-4 rounded border-gray-300 text-[#5A5A40] focus:ring-0 cursor-pointer"
                      />
                      <Label htmlFor="add-lamination-halfEnabled" className="text-sm font-semibold text-gray-800 cursor-pointer select-none">
                        Half Lamination
                      </Label>
                    </div>

                    {formData.lamination?.halfEnabled && (
                      <div className="grid grid-cols-2 gap-3 pt-1 animate-fade-in">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-gray-500 uppercase">Quantity</Label>
                          <Input
                            type="number"
                            value={formData.lamination.halfQty || ''}
                            placeholder="e.g. 1000"
                            onChange={e => setFormData({
                              ...formData,
                              lamination: {
                                ...(formData.lamination || getInitialLamination()),
                                halfQty: e.target.value === '' ? 0 : Number(e.target.value)
                              }
                            })}
                            className="bg-white h-8 text-xs font-semibold"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-gray-500 uppercase">Rate (₹)</Label>
                          <Input
                            type="number"
                            step="any"
                            value={formData.lamination.halfRate || ''}
                            placeholder="e.g. 0.50"
                            onChange={e => setFormData({
                              ...formData,
                              lamination: {
                                ...(formData.lamination || getInitialLamination()),
                                halfRate: e.target.value === '' ? 0 : Number(e.target.value)
                              }
                            })}
                            className="bg-white h-8 text-xs font-semibold"
                            required
                          />
                        </div>
                        {formData.lamination.halfQty && formData.lamination.halfRate && (
                          <div className="col-span-2 text-right text-[10px] text-amber-800 font-mono font-medium">
                            Cost: ₹{(formData.lamination.halfQty * formData.lamination.halfRate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Full Lamination Card */}
                  <div className={`p-4 rounded-2xl border transition-all ${formData.lamination?.fullEnabled ? 'bg-amber-50/30 border-amber-200/60' : 'bg-gray-50 border-gray-150'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="checkbox"
                        id="add-lamination-fullEnabled"
                        checked={!!formData.lamination?.fullEnabled}
                        onChange={e => setFormData({
                          ...formData,
                          lamination: {
                            ...(formData.lamination || getInitialLamination()),
                            fullEnabled: e.target.checked,
                            fullQty: e.target.checked ? (formData.lamination?.fullQty || Number(formData.orderedQuantity) || 0) : 0
                          }
                        })}
                        className="h-4 w-4 rounded border-gray-300 text-[#5A5A40] focus:ring-0 cursor-pointer"
                      />
                      <Label htmlFor="add-lamination-fullEnabled" className="text-sm font-semibold text-gray-800 cursor-pointer select-none">
                        Full Lamination
                      </Label>
                    </div>

                    {formData.lamination?.fullEnabled && (
                      <div className="grid grid-cols-2 gap-3 pt-1 animate-fade-in">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-gray-500 uppercase">Quantity</Label>
                          <Input
                            type="number"
                            value={formData.lamination.fullQty || ''}
                            placeholder="e.g. 1000"
                            onChange={e => setFormData({
                              ...formData,
                              lamination: {
                                ...(formData.lamination || getInitialLamination()),
                                fullQty: e.target.value === '' ? 0 : Number(e.target.value)
                              }
                            })}
                            className="bg-white h-8 text-xs font-semibold"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-gray-500 uppercase">Rate (₹)</Label>
                          <Input
                            type="number"
                            step="any"
                            value={formData.lamination.fullRate || ''}
                            placeholder="e.g. 1.00"
                            onChange={e => setFormData({
                              ...formData,
                              lamination: {
                                ...(formData.lamination || getInitialLamination()),
                                fullRate: e.target.value === '' ? 0 : Number(e.target.value)
                              }
                            })}
                            className="bg-white h-8 text-xs font-semibold"
                            required
                          />
                        </div>
                        {formData.lamination.fullQty && formData.lamination.fullRate && (
                          <div className="col-span-2 text-right text-[10px] text-amber-800 font-mono font-medium">
                            Cost: ₹{(formData.lamination.fullQty * formData.lamination.fullRate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
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
                    if (!formData.isJoint && (pc.id === 'cutting' || pc.id === 'folding')) {
                      return null;
                    }
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

              <BillingSection 
                formData={formData} 
                setFormData={setFormData}
                rawJobs={rawJobs}
                getPaperQuantityForBilling={getPaperQuantityForBilling}
                calculatePaperBillingAmount={calculatePaperBillingAmount}
                stocks={stocks}
                recalculateAllocatedPapersForForm={recalculateAllocatedPapersForForm}
              />

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
                          const jobRef = job.jointRef || '';
                          const masterJob = jobs.find(j => 
                            (job.sharedRunId && j.sharedRunId === job.sharedRunId && j.jointJobType === 'master') ||
                            (jobRef && j.id.slice(-4).toUpperCase() === jobRef.trim().toUpperCase().replace('#', ''))
                          );
                          const jointParentId = masterJob?.id || '';

                          const childPlates = (job.platesUsed && job.platesUsed.length > 0) ? [...job.platesUsed] : [];
                          
                          setFormData({
                            clientName: job.clientName,
                            jobDescription: job.jobDescription,
                            selectedItems: job.items || [],
                            platesUsed: childPlates,
                            processCharges: loadProcessChargesForEditing(job),
                            lamination: job.lamination || getInitialLamination(),
                            ignoreStockLimits: false,
                            orderedQuantity: job.orderedQuantity || '',
                            isJoint: !!job.isJoint,
                            jointJobType: job.jointJobType || '',
                            sharedRunId: job.sharedRunId || '',
                            jointParentId: jointParentId,
                            jointRef: jobRef,
                            isRepeat: !!job.isRepeat,
                            repeatRef: job.repeatRef || '',
                            date: job.date ? format(new Date(job.date), 'yyyy-MM-dd') : new Date().toISOString().split('T')[0],
                            paperBillingMethod: job.paperBillingMethod || '',
                            paperBillingRate: job.paperBillingRate || 0,
                            paperBillingAmount: job.paperBillingAmount || 0,
                            additionalCharges: job.additionalCharges || 0
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
                                  <div className="flex justify-between items-start text-xs md:text-sm">
                                    <div className="flex flex-col min-w-0 mr-2">
                                      <span className="font-semibold truncate text-gray-800 flex items-center gap-1.5 break-all">
                                        {stock?.name || 'Unknown Stock'}
                                        {isJoint && (
                                          <Badge className="bg-amber-500 hover:bg-amber-600 border-none text-white text-[9px] h-4 px-1 leading-none">
                                            Joint Job
                                          </Badge>
                                        )}
                                      </span>
                                    </div>
                                    <span className={`font-mono text-xs font-semibold whitespace-nowrap ${isJoint ? 'text-amber-700' : 'text-gray-600'} bg-gray-100 px-1.5 py-0.5 rounded-md`}>
                                      {((item.allocatedPaper !== undefined && item.allocatedPaper !== null) ? item.allocatedPaper : (item.quantityUsed ?? 0)).toLocaleString()} shs
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
                                              {lj.items?.filter(li => li.stockId === item.stockId).map(li => ((li.allocatedPaper !== undefined && li.allocatedPaper !== null) ? li.allocatedPaper : (li.quantityUsed ?? 0)).toLocaleString()).join(', ') || ((item.allocatedPaper !== undefined && item.allocatedPaper !== null) ? item.allocatedPaper : (item.quantityUsed ?? 0)).toLocaleString()} sheets
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
                              
                              const isDefaultPlate = idx === 0;
                              const isAdditional = !isDefaultPlate && !!plate.isAdditionalPlate;
                              
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
                  </div>

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
                                      <span className="font-bold font-mono text-amber-950">{((item.allocatedPaper !== undefined && item.allocatedPaper !== null) ? item.allocatedPaper : (item.quantityUsed ?? 0)).toLocaleString()} sheets</span>
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
          setFormData({ clientName: '', jobDescription: '', selectedItems: getInitialSelectedItems(), platesUsed: getInitialPlatesUsed(), processCharges: getInitialProcessCharges(), lamination: getInitialLamination(), ignoreStockLimits: false, orderedQuantity: '', isJoint: false, jointRef: '', isRepeat: false, repeatRef: '', date: new Date().toISOString().split('T')[0], paperBillingMethod: '', paperBillingRate: 0, paperBillingAmount: 0, additionalCharges: 0 } as any);
        }}>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Job</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpdateJob} className="space-y-6 py-4">
              {/* UNIQUE_EDIT_FORM_MARKER */}
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <span className="text-xs text-gray-400 font-medium font-mono uppercase tracking-widest">Job Details</span>
                  <div className="flex items-center gap-1.5 bg-gray-50/50 px-2.5 py-1 rounded-xl border border-gray-100 shadow-3xs">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date:</span>
                    <input 
                      type="date" 
                      id="edit-jobDate" 
                      value={formData.date || ''} 
                      onChange={e => setFormData({...formData, date: e.target.value})} 
                      required 
                      className="bg-transparent text-[11px] text-gray-700 font-bold focus:outline-hidden w-[105px] h-auto p-0 border-0 cursor-pointer" 
                    />
                  </div>
                </div>

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
                <div className="space-y-3 p-4 bg-gray-50 rounded-2xl border border-gray-200 mt-3 shadow-xs">
                  <Label className="text-xs uppercase tracking-widest text-[#5A5A40] font-bold">Job Link Workflow / Relationship</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleJobTypeChange('standard')}
                      className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                        !formData.isJoint && !formData.isRepeat
                          ? 'bg-[#5A5A40] text-white border-[#5A5A40] shadow-sm font-bold'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      Standard Job
                    </button>
                    <button
                      type="button"
                      onClick={() => handleJobTypeChange('repeat')}
                      className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                        formData.isRepeat
                          ? 'bg-[#5F7A61] text-white border-[#5F7A61] shadow-sm font-bold'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      Repeat Job
                    </button>
                    <button
                      type="button"
                      onClick={() => handleJobTypeChange('joint')}
                      className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                        formData.isJoint
                          ? 'bg-amber-700 text-white border-amber-700 shadow-sm font-bold'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      Joint Job
                    </button>
                  </div>

                  {/* If Repeat Job is selected */}
                  {formData.isRepeat && (
                    <div className="space-y-1 pt-2 animate-fadeIn transition-all">
                      <Label className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1">
                        <span>Select Previous Job ID</span>
                        <span className="text-red-500 font-bold">*</span>
                      </Label>
                      <Input 
                        type="text" 
                        placeholder="Previous Job Code to repeat/reuse plates (e.g. A3B8)" 
                        list="active-jobs-list"
                        value={(formData as any).repeatRef || ''} 
                        onChange={e => handleRepeatRefChange(e.target.value)}
                        className="bg-white h-10 text-xs rounded-xl font-mono uppercase border-gray-200 focus-visible:ring-[#5F7A61]"
                      />
                    </div>
                  )}

                  {/* If Joint Job is selected */}
                  {formData.isJoint && (
                    <div className="space-y-4 pt-3 border-t border-dashed border-gray-200 mt-2 animate-fadeIn">
                      <Label className="text-xs font-bold text-gray-500 uppercase">Joint Job Type Selection</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              jointJobType: 'master',
                              jointRef: '',
                              jointParentId: '',
                              sharedRunId: ''
                            } as any);
                          }}
                          className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                            formData.jointJobType === 'master'
                              ? 'bg-[#5A5A40] text-white border-[#5A5A40] shadow-sm font-bold'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          Master Joint Job (Job A)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              jointJobType: 'linked',
                              jointRef: '',
                              jointParentId: '',
                              sharedRunId: '',
                              selectedItems: getInitialSelectedItems()
                            } as any);
                          }}
                          className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                            formData.jointJobType === 'linked'
                              ? 'bg-amber-700 text-white border-amber-700 shadow-sm font-bold'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          Linked Joint Job (Job B)
                        </button>
                      </div>

                      {formData.jointJobType === 'master' && (
                        <div className="p-3 bg-amber-50/50 border border-amber-100/70 rounded-xl space-y-1">
                          <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Master Joint Run</span>
                          <span className="text-xs text-amber-700 font-medium">
                            💎 Registered Run: <strong className="font-mono text-amber-900">{formData.sharedRunId || 'JR??? (Will generate on save)'}</strong>
                          </span>
                          <span className="block text-[10px] text-amber-600/85">Paper stock deduction happens only from this Master run. Linked jobs will share and allocate automatically.</span>
                        </div>
                      )}

                      {formData.jointJobType === 'linked' && (
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
                              <span>Joint Reference (Master Joint Job)</span>
                              <span className="text-red-500 font-bold">*</span>
                            </Label>
                            
                            <Select 
                              value={formData.jointParentId || ''} 
                              onValueChange={(val) => handleSelectParentMasterJob(val)}
                            >
                              <SelectTrigger className="w-full bg-white border-gray-200 h-10 rounded-xl text-xs">
                                <SelectValue placeholder="Search Existing Master Joint Job..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {jobs.filter(j => j.isJoint && j.jointJobType === 'master').length === 0 ? (
                                    <SelectItem value="none" disabled>No Master Joint Jobs found. Create a Master job first.</SelectItem>
                                  ) : (
                                    jobs.filter(j => j.isJoint && j.jointJobType === 'master').map(mj => (
                                      <SelectItem key={mj.id} value={mj.id}>
                                        {mj.sharedRunId || 'JR???'} - {mj.clientName} ({mj.jobDescription}) [code: #{mj.id.slice(-4).toUpperCase()}]
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </div>

                          {formData.jointParentId && (
                            <div className="p-3 bg-green-50/50 border border-green-100/75 rounded-xl space-y-1">
                              <span className="text-[10px] font-bold text-green-800 uppercase tracking-wider block">Status</span>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-green-700 font-medium font-serif font-sans">
                                <span className="flex items-center gap-1">
                                  ✓ Shared Run ({formData.sharedRunId || 'Pending'})
                                </span>
                                <span className="flex items-center gap-1">
                                  ✓ Paper Shared
                                </span>
                                <span className="flex items-center gap-1">
                                  ✓ Allocation Calculated
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
               
              {formData.isRepeat && (
                <div className="p-5 bg-emerald-50/50 rounded-2xl border border-emerald-100/70 space-y-4 mb-3">
                  <h4 className="font-serif text-sm font-semibold text-emerald-950 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                    Repeat Job Configuration
                  </h4>
                  <p className="text-xs text-emerald-900 leading-relaxed">
                    Plates are reused automatically from previous job{' '}
                    <span className="font-mono font-extrabold bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-950 border border-emerald-200 shadow-sm">
                      #{formData.repeatRef ? formData.repeatRef.toUpperCase() : '????'}
                    </span>. Plate stock will <span className="font-bold text-emerald-700">not</span> be deducted.
                  </p>
                  
                  {(() => {
                    const cleanRef = (formData.repeatRef || '').trim().toUpperCase().replace('#', '');
                    const matchingJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
                    return (
                      <div className="text-xs bg-white p-4 rounded-xl border border-gray-100/80 space-y-2.5">
                        {matchingJob ? (
                          <div className="space-y-3">
                            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                              <span className="text-gray-500 font-medium font-serif">Referenced Print Job:</span>
                              <span className="font-semibold text-gray-900 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200 text-slate-800">
                                Job #{cleanRef} ({matchingJob.clientName})
                              </span>
                            </div>
                            
                            {/* Detected Plates */}
                            {(() => {
                              const platesToDisplay = getCalculatedReusedPlates(matchingJob.platesUsed);

                              return platesToDisplay.length > 0 ? (
                                <div className="space-y-1.5 pt-2">
                                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Auto-detected Reused Plates:</span>
                                  {platesToDisplay.map((p, idx) => {
                                    const stock = stocks.find(s => s.id === p.plateId);
                                    return (
                                      <div key={idx} className="flex justify-between items-center text-[11px] bg-emerald-50/30 px-2.5 py-1.5 rounded-lg border border-emerald-100/30">
                                        <div className="flex flex-col gap-0.5">
                                          <span className="font-semibold text-emerald-950">{stock?.name || 'Plate'}</span>
                                          {p.label && (
                                            <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded leading-none w-fit ${
                                              p.label === 'Plate Left Earlier' ? 'bg-amber-100 text-amber-800' :
                                              p.label === 'Additional Plate' ? 'bg-pink-100 text-pink-800' :
                                              'bg-emerald-100 text-emerald-800'
                                            }`}>
                                              {p.label}
                                            </span>
                                          )}
                                        </div>
                                        <span className="font-mono bg-emerald-100/20 px-2.5 py-1 rounded text-emerald-800 font-bold">{p.count} plates (Reused)</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-[11px] text-gray-500 italic pt-1.5 border-t border-gray-100">
                                  No plates detected in the referenced job.
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div className="text-gray-400 italic text-center py-2 font-serif">
                            {formData.repeatRef ? 'Searching / Loading referenced job details...' : 'Please enter a valid four-digit job code above'}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="text-lg font-serif">Papers Used</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddItem} className="rounded-full">
                    <Plus className="mr-1 h-3 w-3" /> Add Paper
                  </Button>
                </div>
                
                {formData.selectedItems.map((item, index) => { /* EDIT_FORM_EXCLUSIVE */
                  const isLinkedJob = !!(formData.isJoint && formData.jointJobType === 'linked');
                  return (
                    <div key={index} className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-4 relative">
                      <div className="absolute top-4 right-4 animate-fadeIn">
                        {!isLinkedJob && (
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleRemoveItem(index)} 
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full h-8 px-2"
                          >
                            Remove Paper
                          </Button>
                        )}
                      </div>

                      <h4 className="font-serif text-sm font-semibold text-gray-700">Paper Item #{index + 1}</h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                        {/* Paper Stock */}
                        <div className="md:col-span-6 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Select Paper Stock</Label>
                          {isLinkedJob ? (
                            <Input 
                              value={stocks.find(s => s.id === item.stockId)?.name || 'Matching Parent Stock'} 
                              readOnly 
                              className="bg-gray-100 border-gray-200 h-9 cursor-not-allowed text-gray-600 font-medium"
                            />
                          ) : (
                            <StockSelect 
                              value={item.stockId} 
                              onValueChange={(v) => handleItemChange(index, 'stockId', v)}
                              stocks={stocks}
                              type="paper"
                              placeholder="Choose paper..."
                            />
                          )}
                        </div>

                        {/* Matter Ups */}
                        <div className="md:col-span-6 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Matter Ups</Label>
                          <Input 
                            type="number" 
                            placeholder="e.g. 1"
                            value={item.ups || ''} 
                            onChange={e => handleItemChange(index, 'ups', e.target.value === '' ? undefined : Number(e.target.value))} 
                            onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                            className="bg-gray-50 border-gray-200 h-9"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-gray-100">
                        {/* Total Sheets Used */}
                        <div className="md:col-span-4 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">
                            {formData.isJoint ? "Total Sheets Used" : "Actual Sheets Used"}
                          </Label>
                          <Input 
                            type="number" 
                            value={item.quantityUsed === 0 ? '' : item.quantityUsed} 
                            onChange={e => handleItemChange(index, 'quantityUsed', e.target.value === '' ? 0 : Number(e.target.value))} 
                            onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                            required
                            readOnly={isLinkedJob}
                            placeholder={isLinkedJob ? "Linked from parent" : "sheets"}
                            className={`${isLinkedJob ? "bg-gray-100 cursor-not-allowed text-gray-600 font-medium" : "bg-gray-50"} border-gray-200 h-9`}
                          />
                        </div>

                        {/* Wastage Sheets */}
                        <div className="md:col-span-4 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Wastage Sheets</Label>
                          <Input 
                            type="number" 
                            value={item.wastageSheets === undefined ? 0 : item.wastageSheets} 
                            onChange={e => handleItemChange(index, 'wastageSheets', e.target.value === '' ? 0 : Number(e.target.value))} 
                            onFocus={e => { if (e.target.value === '0') e.target.select(); }}
                            readOnly={isLinkedJob}
                            placeholder={isLinkedJob ? "Linked from parent" : "sheets"}
                            className={`${isLinkedJob ? "bg-gray-100 cursor-not-allowed text-gray-600 font-medium" : "bg-gray-50"} border-gray-200 h-9`}
                          />
                        </div>

                        {/* Allocated Paper */}
                        <div className="md:col-span-4 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Allocated Paper</Label>
                          <Input 
                            value={(item.allocatedPaper || 0).toLocaleString()}
                            readOnly
                            placeholder="Auto Calculated"
                            className="bg-green-50 border-green-200 h-9 font-semibold text-green-700 cursor-default"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-gray-100">
                        {/* Produced Quantity */}
                        <div className="md:col-span-12 space-y-1.5">
                          <Label className="text-xs font-bold text-gray-500 uppercase">Produced Quantity (Read Only)</Label>
                          <Input 
                            value={((item.allocatedPaper !== undefined ? item.allocatedPaper : (item.quantityUsed || 0)) * (item.ups || 1)).toLocaleString()}
                            readOnly
                            placeholder="Sheets × Ups"
                            className="bg-blue-50 border-blue-200 h-9 font-semibold text-blue-700 cursor-default"
                          />
                        </div>
                      </div>
                      
                      {isLinkedJob && item.paperRef && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 md:bg-amber-50/70 border border-amber-100 text-[11px] text-amber-800 rounded-lg animate-fadeIn">
                          <span className="font-semibold font-mono bg-amber-200/60 px-1 py-0.5 rounded">Joint Job Reference: #{item.paperRef}</span>
                          <span>(Paper Stock and Rate inherited automatically from Parent Master Job)</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

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
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <Label className="text-xs font-semibold text-gray-700">Select Plate</Label>
                          {plate.isAdditionalPlate && (
                            <Badge className="bg-pink-500 hover:bg-pink-600 border-none text-white text-[9px] h-4 px-1.5 leading-none uppercase tracking-wider font-bold">
                              Additional Plate
                            </Badge>
                          )}
                        </div>
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

                    {/* Cancelled checkbox in Edit Form */}
                    <div className="col-span-12 flex flex-wrap gap-4 pt-2 border-t border-gray-100/60 mt-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`edit-plate-cancelled-${index}`}
                          checked={!!plate.isCancelled}
                          onChange={e => {
                            const val = e.target.checked;
                            handlePlateChange(index, 'isCancelled', val);
                            if (val && !plate.cancelledColor) {
                              handlePlateChange(index, 'cancelledColor', 'C');
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-red-550 focus:ring-0 cursor-pointer"
                        />
                        <Label htmlFor={`edit-plate-cancelled-${index}`} className="text-xs text-red-600 font-semibold select-none cursor-pointer">
                          Cancelled for Future Repeat (Retired Plate - Client is Charged)
                        </Label>
                      </div>
                    </div>

                    {plate.isCancelled && (
                      <div className="col-span-12 space-y-3 px-4 py-3 bg-red-50/50 border border-red-200/50 rounded-2xl mt-1.5 animate-fadeIn">
                        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-1">
                            <span className="text-xs font-bold text-red-800 block">Choose Cancelled Color Channel(s):</span>
                            <span className="text-[10px] text-red-600 block leading-tight">Select all colors that apply to this retired/spoiled plate block.</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(['C', 'M', 'Y', 'K'] as const).map(color => {
                              const isSelected = (plate.cancelledColor || '').split('/').includes(color);
                              return (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => handleToggleCancelledColor(index, color)}
                                  className={`h-7 px-3 text-xs font-extrabold rounded-lg border transition-all cursor-pointer ${
                                    isSelected
                                      ? 'bg-red-600 text-white border-red-600 shadow-xs font-bold'
                                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  {color}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="pt-2 border-t border-red-200/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                          <span className="text-xs text-red-700 font-medium">Need to add another plate to compensate for this cancelled one?</span>
                          <button
                            type="button"
                            onClick={() => handleAddReplacementPlate(index)}
                            className="bg-red-600/15 hover:bg-red-600/25 text-red-800 text-xs font-bold py-1.5 px-3.5 rounded-xl border border-red-200 transition-all flex items-center gap-1.5 shadow-xs w-fit cursor-pointer"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                            Add Additional Plate Used
                          </button>
                        </div>
                      </div>
                    )}

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

              {/* Lamination Options Section inside Edit Modal */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center">
                  <Label className="text-lg font-serif">Lamination Details</Label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Half Lamination Card */}
                  <div className={`p-4 rounded-2xl border transition-all ${formData.lamination?.halfEnabled ? 'bg-amber-50/30 border-amber-200/60' : 'bg-gray-50 border-gray-150'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="checkbox"
                        id="edit-lamination-halfEnabled"
                        checked={!!formData.lamination?.halfEnabled}
                        onChange={e => setFormData({
                          ...formData,
                          lamination: {
                            ...(formData.lamination || getInitialLamination()),
                            halfEnabled: e.target.checked,
                            halfQty: e.target.checked ? (formData.lamination?.halfQty || Number(formData.orderedQuantity) || 0) : 0
                          }
                        })}
                        className="h-4 w-4 rounded border-gray-300 text-[#5A5A40] focus:ring-0 cursor-pointer"
                      />
                      <Label htmlFor="edit-lamination-halfEnabled" className="text-sm font-semibold text-gray-800 cursor-pointer select-none">
                        Half Lamination
                      </Label>
                    </div>

                    {formData.lamination?.halfEnabled && (
                      <div className="grid grid-cols-2 gap-3 pt-1 animate-fade-in">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-gray-500 uppercase">Quantity</Label>
                          <Input
                            type="number"
                            value={formData.lamination.halfQty || ''}
                            placeholder="e.g. 1000"
                            onChange={e => setFormData({
                              ...formData,
                              lamination: {
                                ...(formData.lamination || getInitialLamination()),
                                halfQty: e.target.value === '' ? 0 : Number(e.target.value)
                              }
                            })}
                            className="bg-white h-8 text-xs font-semibold"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-gray-500 uppercase">Rate (₹)</Label>
                          <Input
                            type="number"
                            step="any"
                            value={formData.lamination.halfRate || ''}
                            placeholder="e.g. 0.50"
                            onChange={e => setFormData({
                              ...formData,
                              lamination: {
                                ...(formData.lamination || getInitialLamination()),
                                halfRate: e.target.value === '' ? 0 : Number(e.target.value)
                              }
                            })}
                            className="bg-white h-8 text-xs font-semibold"
                            required
                          />
                        </div>
                        {formData.lamination.halfQty && formData.lamination.halfRate && (
                          <div className="col-span-2 text-right text-[10px] text-amber-800 font-mono font-medium">
                            Cost: ₹{(formData.lamination.halfQty * formData.lamination.halfRate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Full Lamination Card */}
                  <div className={`p-4 rounded-2xl border transition-all ${formData.lamination?.fullEnabled ? 'bg-amber-50/30 border-amber-200/60' : 'bg-gray-50 border-gray-150'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="checkbox"
                        id="edit-lamination-fullEnabled"
                        checked={!!formData.lamination?.fullEnabled}
                        onChange={e => setFormData({
                          ...formData,
                          lamination: {
                            ...(formData.lamination || getInitialLamination()),
                            fullEnabled: e.target.checked,
                            fullQty: e.target.checked ? (formData.lamination?.fullQty || Number(formData.orderedQuantity) || 0) : 0
                          }
                        })}
                        className="h-4 w-4 rounded border-gray-300 text-[#5A5A40] focus:ring-0 cursor-pointer"
                      />
                      <Label htmlFor="edit-lamination-fullEnabled" className="text-sm font-semibold text-gray-800 cursor-pointer select-none">
                        Full Lamination
                      </Label>
                    </div>

                    {formData.lamination?.fullEnabled && (
                      <div className="grid grid-cols-2 gap-3 pt-1 animate-fade-in">
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-gray-500 uppercase">Quantity</Label>
                          <Input
                            type="number"
                            value={formData.lamination.fullQty || ''}
                            placeholder="e.g. 1000"
                            onChange={e => setFormData({
                              ...formData,
                              lamination: {
                                ...(formData.lamination || getInitialLamination()),
                                fullQty: e.target.value === '' ? 0 : Number(e.target.value)
                              }
                            })}
                            className="bg-white h-8 text-xs font-semibold"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-bold text-gray-500 uppercase">Rate (₹)</Label>
                          <Input
                            type="number"
                            step="any"
                            value={formData.lamination.fullRate || ''}
                            placeholder="e.g. 1.00"
                            onChange={e => setFormData({
                              ...formData,
                              lamination: {
                                ...(formData.lamination || getInitialLamination()),
                                fullRate: e.target.value === '' ? 0 : Number(e.target.value)
                              }
                            })}
                            className="bg-white h-8 text-xs font-semibold"
                            required
                          />
                        </div>
                        {formData.lamination.fullQty && formData.lamination.fullRate && (
                          <div className="col-span-2 text-right text-[10px] text-amber-800 font-mono font-medium">
                            Cost: ₹{(formData.lamination.fullQty * formData.lamination.fullRate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
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
                    if (!formData.isJoint && (pc.id === 'cutting' || pc.id === 'folding')) {
                      return null;
                    }
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

              <BillingSection 
                formData={formData} 
                setFormData={setFormData}
                rawJobs={rawJobs}
                getPaperQuantityForBilling={getPaperQuantityForBilling}
                calculatePaperBillingAmount={calculatePaperBillingAmount}
                stocks={stocks}
                recalculateAllocatedPapersForForm={recalculateAllocatedPapersForForm}
              />

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

      {isAuditLogsOpen && (
        <Dialog open={isAuditLogsOpen} onOpenChange={setIsAuditLogsOpen}>
          <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="text-xl font-serif text-[#5A5A40]">Joint Run Audit Logs</DialogTitle>
            </DialogHeader>
            <div className="mt-4 space-y-3">
              {auditLogs.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400 font-serif italic">
                  No joint run changes logged yet.
                </div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto pr-2">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="py-3 space-y-1">
                      <div className="flex justify-between items-start text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-amber-800">
                          <span className="bg-amber-150 text-amber-900 px-2 py-0.5 rounded-sm uppercase tracking-wide text-[9px] font-mono">
                            {log.sharedRunId}
                          </span>
                          <span>{log.changedField}</span>
                        </div>
                        <span className="text-gray-450 font-mono text-[10px]">
                          {format(new Date(log.timestamp), 'dd MMM yyyy, hh:mm a')}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 font-medium leading-relaxed pl-1">
                        Changed from <code className="bg-red-50 text-red-600 px-1 py-0.5 rounded font-mono text-[11px] break-all">{log.oldValue || 'none'}</code> to <code className="bg-emerald-50 text-emerald-700 px-1 py-0.5 rounded font-mono text-[11px] font-bold break-all">{log.newValue || 'none'}</code>
                      </div>
                      <div className="text-[10px] text-gray-400 pl-1">
                        By: <span className="font-semibold text-gray-500">{log.userEmail}</span> • Affected Jobs: <span className="font-mono text-gray-500 font-semibold">{log.affectedJobs?.join(', ') || 'none'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAuditLogsOpen(false)} className="rounded-full">
                Close Audit Logs
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