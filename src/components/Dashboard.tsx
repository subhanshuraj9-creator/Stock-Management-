import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, orderBy, onSnapshot, getDocs, writeBatch, doc, addDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { StockItem, Job, Payment, StockHistory, JointRun, Expense } from '../types';
import { useFirebaseData } from '../contexts/FirebaseDataContext';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Package, FileText, AlertTriangle, TrendingUp, Clock, ArrowRight, Trash2, Truck, IndianRupee, ArrowUpRight, BarChart3, TrendingDown, Plus, Edit, PlusCircle, Calendar, Receipt } from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { getJobCode } from '../lib/utils';

function getJobRunId(job: any, allJobs?: any[]): string {
  if (job.sharedRunId) return job.sharedRunId.trim().toUpperCase();
  if (job.isJoint) {
    if (job.jointRef) {
      return job.jointRef.trim().toUpperCase().replace('#', '');
    }
    if (job.id) {
      return getJobCode(job, allJobs);
    }
  }
  return '';
}

function synchronizeJobsData(allJobs: any[], allJointRuns: JointRun[]): any[] {
  // 1. Resolve paper/rate copy & alignment across groups based on JointRuns first
  const jobsWithResolvedJoints = allJobs.map(job => {
    const resolvedJob = {
      ...job,
      items: (job.items || []).map((it: any) => ({ ...it })),
      platesUsed: (job.platesUsed || []).map((it: any) => ({ ...it }))
    };

    if (resolvedJob.isJoint && resolvedJob.sharedRunId) {
      // Find JointRun
      const jr = allJointRuns.find(r => r.sharedRunId === resolvedJob.sharedRunId);
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
    const runId = getJobRunId(job, allJobs);
    if (runId) {
      if (!runIdToGroupJobs.has(runId)) {
        runIdToGroupJobs.set(runId, []);
      }
      runIdToGroupJobs.get(runId)!.push(job);
    }
  });

  // For any group, if there is no matching JointRun, we do the fallback in-memory synchronization
  runIdToGroupJobs.forEach((group, runId) => {
    const hasRealRun = allJointRuns.some(r => r.sharedRunId === runId);
    if (!hasRealRun) {
      const masterJob = group.find(j => j.jointJobType === 'master') || 
                        group.find(j => j.id && getJobCode(j, allJobs) === runId) ||
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

const CATEGORY_COLORS: Record<string, string> = {
  'Salaries & Wages': 'bg-blue-50 text-blue-700 border-blue-100',
  'Rent & Lease': 'bg-purple-50 text-purple-700 border-purple-100',
  'Electricity & Power': 'bg-amber-50 text-amber-700 border-amber-100',
  'Machine Maintenance': 'bg-orange-50 text-orange-700 border-orange-100',
  'Transport & Logistics': 'bg-sky-50 text-sky-700 border-sky-100',
  'Printing plates / Raw materials': 'bg-emerald-50 text-emerald-700 border-emerald-100',
  'Office Supplies': 'bg-gray-50 text-gray-700 border-gray-100',
  'Miscellaneous / Others': 'bg-slate-50 text-slate-750 border-slate-150',
};

const EXPENSE_CATEGORIES = [
  'Salaries & Wages',
  'Rent & Lease',
  'Electricity & Power',
  'Machine Maintenance',
  'Transport & Logistics',
  'Printing plates / Raw materials',
  'Office Supplies',
  'Miscellaneous / Others'
];

export function Dashboard() {
  const {
    stocks,
    jobs: rawJobs,
    jointRuns,
    payments,
    stockHistory: history,
    expenses,
  } = useFirebaseData();

  const allJobs = React.useMemo(() => {
    return synchronizeJobsData(rawJobs, jointRuns);
  }, [rawJobs, jointRuns]);
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    category: 'Miscellaneous / Others',
    notes: ''
  });
  const [selectedExpenseMonth, setSelectedExpenseMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleClearActivity = async () => {
    setIsClearing(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'jobs'));
      const batch = writeBatch(db);
      querySnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      toast.success('All printing job activities cleared successfully');
      setIsClearConfirmOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'jobs');
    } finally {
      setIsClearing(false);
    }
  };

  // Accounting helpers
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

  const computeJobDebit = (job: Job, jobsList: Job[], stocksList: StockItem[]) => {
    // 1. Calculate paper stock material cost
    const paperStockMaterialCost = (job.items || []).reduce((sum, item) => {
      const sheetsUsed = item.allocatedPaper !== undefined ? item.allocatedPaper : (item.quantityUsed || 0);
      return sum + (sheetsUsed * (item.paperRate || 0));
    }, 0);

    // 2. Determine paperTotal using stored paperBillingAmount or falling back to material cost
    const billingQty = (job.items || []).reduce((sum, item) => {
      const sheetsUsed = item.allocatedPaper !== undefined ? item.allocatedPaper : (item.quantityUsed || 0);
      return sum + sheetsUsed;
    }, 0);

    let paperTotal = paperStockMaterialCost;
    if (job.paperBillingMethod) {
      if (job.paperBillingMethod === 'custom') {
        paperTotal = job.paperBillingAmount || 0;
      } else {
        const rate = job.paperBillingRate || 0;
        let calculated = 0;
        switch (job.paperBillingMethod) {
          case '100sheets':
            calculated = (billingQty / 100) * rate;
            break;
          case 'gross':
            calculated = (billingQty / 144) * rate;
            break;
          case 'ream':
            calculated = (billingQty / 500) * rate;
            break;
        }
        paperTotal = Math.round(calculated * 100) / 100;
      }
    }

    let plateTotal = 0;
    const platesToProcess = [...(job.platesUsed || [])];

    if (job.isJoint && job.jointRef) {
      const cleanRef = job.jointRef.trim().toUpperCase().replace('#', '');
      const referencedJob = jobsList.find(j => getJobCode(j, jobsList) === cleanRef);
      if (referencedJob && referencedJob.platesUsed) {
        referencedJob.platesUsed.forEach(refPlate => {
          const isDuplicate = platesToProcess.some(p => p.plateId === refPlate.plateId);
          if (!isDuplicate) {
            platesToProcess.push({
              ...refPlate,
              isJointRef: true,
              refJobId: referencedJob.id
            } as any);
          }
        });
      }
    }

    platesToProcess.forEach(plate => {
      const plateCost = (plate.count || 0) * (plate.rate || 0);
      plateTotal += plateCost;
    });

    let processTotal = 0;
    (job.processCharges || []).forEach(pc => {
      if (pc.amount > 0) {
        processTotal += pc.amount;
      }
    });

    let laminationTotal = 0;
    if (job.lamination?.halfEnabled) {
      laminationTotal += (job.lamination.halfQty || 0) * (job.lamination.halfRate || 0);
    }
    if (job.lamination?.fullEnabled) {
      laminationTotal += (job.lamination.fullQty || 0) * (job.lamination.fullRate || 0);
    }

    const additionalCharges = job.additionalCharges || 0;

    return paperTotal + plateTotal + processTotal + laminationTotal + additionalCharges;
  };

  // Memoized lists for graphs
  const partyOutstandingList = React.useMemo(() => {
    const uniqueParties = Array.from(new Set([
      ...allJobs.map(j => j.clientName.trim()),
      ...payments.map(p => p.clientName.trim())
    ])).filter(name => name.length > 0);

    return uniqueParties.map(partyName => {
      const partyJobs = allJobs.filter(j => j.clientName.trim().toLowerCase() === partyName.trim().toLowerCase());
      const partyPayments = payments.filter(p => p.clientName.trim().toLowerCase() === partyName.trim().toLowerCase());

      let totalDebit = 0;
      partyJobs.forEach(job => {
        totalDebit += computeJobDebit(job, allJobs, stocks);
      });

      const totalPaid = partyPayments.reduce((sum, p) => sum + p.amount, 0);
      const outstanding = totalDebit - totalPaid;

      return {
        partyName,
        totalBilled: totalDebit,
        totalPaid,
        outstanding: outstanding > 1 ? outstanding : 0,
      };
    })
    .filter(p => p.outstanding > 1)
    .sort((a, b) => b.outstanding - a.outstanding);
  }, [allJobs, payments, stocks]);

  const monthlyExpensesList = React.useMemo(() => {
    const monthlyData: { [key: string]: number } = {};

    history.filter(h => h.type === 'addition').forEach(record => {
      let cost = 0;
      const notes = record.notes || '';
      const match = notes.match(/Total Cost:\s*₹\s*([0-9,.]+)/i);
      if (match) {
        cost = parseFloat(match[1].replace(/,/g, ''));
      } else if (record.purchaseRate && record.quantity) {
        cost = record.quantity * record.purchaseRate;
      }

      if (isNaN(cost) || cost <= 0) return;

      const dateObj = new Date(record.date);
      const year = dateObj.getFullYear();
      const month = dateObj.getMonth();
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;

      monthlyData[key] = (monthlyData[key] || 0) + cost;
    });

    const sortedKeys = Object.keys(monthlyData).sort();
    const recentKeys = sortedKeys.slice(-8);

    return recentKeys.map(key => {
      const [year, month] = key.split('-');
      const monthName = format(new Date(parseInt(year), parseInt(month) - 1, 1), 'MMM yyyy');
      return {
        key,
        monthName,
        expense: monthlyData[key],
      };
    });
  }, [history]);

  const monthlyRevenueList = React.useMemo(() => {
    const revenueData: { [key: string]: { revenue: number; collections: number; expenses: number } } = {};

    allJobs.forEach(job => {
      const totalDebit = computeJobDebit(job, allJobs, stocks);
      const dateObj = new Date(job.date);
      const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

      if (!revenueData[key]) {
        revenueData[key] = { revenue: 0, collections: 0, expenses: 0 };
      }
      revenueData[key].revenue += totalDebit;
    });

    payments.forEach(p => {
      const dateObj = new Date(p.date);
      const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

      if (!revenueData[key]) {
        revenueData[key] = { revenue: 0, collections: 0, expenses: 0 };
      }
      revenueData[key].collections += p.amount;
    });

    // Manual custom expenses
    expenses.forEach(exp => {
      const dateObj = new Date(exp.date);
      const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

      if (!revenueData[key]) {
        revenueData[key] = { revenue: 0, collections: 0, expenses: 0 };
      }
      revenueData[key].expenses += Number(exp.amount) || 0;
    });

    const sortedKeys = Object.keys(revenueData).sort();
    const recentKeys = sortedKeys.slice(-8);

    return recentKeys.map(key => {
      const [year, month] = key.split('-');
      const monthName = format(new Date(parseInt(year), parseInt(month) - 1, 1), 'MMM yyyy');
      return {
        key,
        monthName,
        revenue: revenueData[key].revenue,
        collections: revenueData[key].collections,
        expenses: revenueData[key].expenses || 0,
      };
    });
  }, [allJobs, payments, stocks, expenses]);

  const totalOutstandingMarketValue = partyOutstandingList.reduce((sum, p) => sum + p.outstanding, 0);

  const currentMonthExpenses = React.useMemo(() => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthlyRecord = monthlyRevenueList.find(m => m.key === currentMonthKey);
    return monthlyRecord ? monthlyRecord.expenses : 0;
  }, [monthlyRevenueList]);

  const totalSheets = stocks.filter(s => s.type === 'paper' || s.type === 'board').reduce((acc, s) => acc + s.quantity, 0);
  
  const lowPaper = stocks.filter(s => s.type === 'paper' && s.quantity < 500);
  const lowBoard = stocks.filter(s => s.type === 'board' && s.quantity < 500);
  const lowInk = stocks.filter(s => s.type === 'ink' && (s.inkContainers?.reduce((acc, c) => acc + c.count, 0) || 0) < 10);
  const lowPlates = stocks.filter(s => s.type === 'plate' && s.quantity < 10);
  
  const totalLowStock = lowPaper.length + lowBoard.length + lowInk.length + lowPlates.length;
  const pendingJobs = allJobs.filter(job => job.dispatchStatus !== 'completed');

  // Dynamic Month List for Expense Filter dropdown
  const expenseMonthsList = React.useMemo(() => {
    const monthKeys = new Set<string>();
    
    // Add current month and last 12 months
    const today = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.add(key);
    }
    
    // Add any months from expenses
    expenses.forEach(e => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.add(key);
    });

    return Array.from(monthKeys).sort().reverse().map(key => {
      const [year, month] = key.split('-');
      const label = format(new Date(parseInt(year), parseInt(month) - 1, 1), 'MMMM yyyy');
      return { key, label };
    });
  }, [expenses]);

  // Filter custom expenses list for the selected month
  const filteredExpenses = React.useMemo(() => {
    return expenses.filter(e => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === selectedExpenseMonth;
    }).sort((a, b) => b.date - a.date);
  }, [expenses, selectedExpenseMonth]);

  const selectedMonthGeneralTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Firebase operation handlers
  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseForm.title || !expenseForm.amount || !expenseForm.date) {
      toast.error('Please fill in all required fields');
      return;
    }

    const payload = {
      title: expenseForm.title.trim(),
      amount: Number(expenseForm.amount),
      date: new Date(expenseForm.date).getTime(),
      category: expenseForm.category,
      notes: expenseForm.notes.trim()
    };

    try {
      if (editingExpense) {
        await updateDoc(doc(db, 'expenses', editingExpense.id), payload);
        toast.success('Expense updated successfully');
      } else {
        await addDoc(collection(db, 'expenses'), payload);
        toast.success('Expense logged successfully');
      }
      setIsExpenseDialogOpen(false);
      setEditingExpense(null);
      setExpenseForm({
        title: '',
        amount: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        category: 'Miscellaneous / Others',
        notes: ''
      });
    } catch (error) {
      handleFirestoreError(error, editingExpense ? OperationType.UPDATE : OperationType.CREATE, 'expenses');
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this expense record?')) return;
    try {
      await deleteDoc(doc(db, 'expenses', id));
      toast.success('Expense record deleted successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'expenses');
    }
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div>
        <h2 className="text-2xl md:text-3xl font-serif font-medium text-gray-900">Dashboard</h2>
        <p className="text-sm md:text-base text-gray-500 font-serif italic">Overview of your printing press operations</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
        <StatCard 
          title="Low Stock Alert" 
          value={totalLowStock.toString()} 
          subtitle="Items requiring attention"
          icon={<AlertTriangle className="text-amber-600" />}
          color="bg-amber-50"
          highlight={totalLowStock > 0}
          onClick={() => {
            document.getElementById('low-stock-items')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
        <StatCard 
          title="To Be Dispatched" 
          value={pendingJobs.length.toString()} 
          subtitle="Jobs awaiting complete delivery"
          icon={<Truck className="text-purple-600" />}
          color="bg-purple-50"
          onClick={() => {
            document.getElementById('jobs-to-dispatch')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      </div>

      {/* Financial Metrics & Charts Section */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-xl md:text-2xl font-serif font-medium text-gray-950 flex items-center gap-2">
              <BarChart3 size={22} className="text-[#5A5A40]" />
              Financial & Ledger Insights
            </h3>
            <p className="text-xs md:text-sm text-gray-500 font-serif italic">Real-time ledger analytics, market receivables, and material expenses</p>
          </div>
          <div className="p-3 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3.5 mt-1 sm:mt-0">
            <div className="p-2 bg-[#A8201A] text-white rounded-xl">
              <IndianRupee size={16} />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold tracking-wider text-red-600 font-mono">Market Outstanding</p>
              <p className="text-base md:text-lg font-bold text-red-950 font-mono">₹{totalOutstandingMarketValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>

        {/* Analytics Graphs Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
          {/* Monthly Revenue & Cash Collection */}
          <Card className="lg:col-span-2 border-none shadow-sm bg-white rounded-[24px] overflow-hidden flex flex-col justify-between">
            <CardHeader className="p-6 pb-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="font-serif text-lg md:text-xl flex items-center gap-2.5">
                  <ArrowUpRight size={22} className="text-emerald-600" />
                  Monthly Ledger Revenue, Collections & Expenses
                </CardTitle>
                <div className="flex items-center gap-3 text-[10px] sm:text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span>Billed (Revenue)</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-medium text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                    <span>Collected (Payments)</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-medium text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span>Expenses</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 font-serif italic mt-1">Comparison of overall billed printing jobs, payments collected, and operational/stock expenses</p>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              {monthlyRevenueList.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400 font-serif italic text-sm">
                  No billing, receipt, or expense activity loaded to plot.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Vertical bar grid */}
                  <div className="h-64 flex items-end justify-between gap-3 sm:gap-4 pt-6 px-2 border-b border-gray-100 relative">
                    {/* Y Axis line guides */}
                    <div className="absolute left-0 right-0 top-1/4 border-t border-dashed border-gray-100 pointer-events-none" />
                    <div className="absolute left-0 right-0 top-2/4 border-t border-dashed border-gray-100 pointer-events-none" />
                    <div className="absolute left-0 right-0 top-3/4 border-t border-dashed border-gray-100 pointer-events-none" />

                    {monthlyRevenueList.map((item, index) => {
                      const maxVal = Math.max(
                        ...monthlyRevenueList.map(m => Math.max(m.revenue, m.collections, m.expenses)),
                        1000
                      );
                      const revPercent = (item.revenue / maxVal) * 100;
                      const colPercent = (item.collections / maxVal) * 100;
                      const expPercent = (item.expenses / maxVal) * 100;

                      return (
                        <div key={item.key} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                          {/* Tooltip */}
                          <div className="absolute bottom-full mb-2 bg-slate-900 text-white text-[10px] md:text-xs font-mono font-bold py-2.5 px-3 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none shadow-xl z-20 text-left min-w-[190px] border border-slate-800">
                            <div className="font-serif italic font-medium pb-1.5 border-b border-slate-800 text-gray-300">{item.monthName}</div>
                            <div className="text-emerald-400 pt-1.5 flex justify-between gap-4">
                              <span>Revenue:</span>
                              <span>₹{item.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            </div>
                            <div className="text-sky-400 mt-1 flex justify-between gap-4">
                              <span>Payments:</span>
                              <span>₹{item.collections.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            </div>
                            <div className="text-rose-400 mt-1 flex justify-between gap-4">
                              <span>Expenses:</span>
                              <span>₹{item.expenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            </div>
                          </div>

                          {/* Columns */}
                          <div className="flex items-end gap-1 w-full h-full max-w-[64px]">
                            {/* Revenue column */}
                            <div className="flex-1 h-full bg-emerald-50 rounded-t-md overflow-hidden flex items-end">
                              <motion.div 
                                className="w-full bg-gradient-to-t from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 rounded-t-md shadow-2xs transition-all"
                                style={{ height: `${revPercent}%` }}
                                initial={{ height: 0 }}
                                animate={{ height: `${revPercent}%` }}
                                transition={{ duration: 0.8, delay: index * 0.05 }}
                              />
                            </div>
                            
                            {/* Collection column */}
                            <div className="flex-1 h-full bg-sky-50 rounded-t-md overflow-hidden flex items-end">
                              <motion.div 
                                className="w-full bg-gradient-to-t from-sky-400 to-sky-500 hover:from-sky-500 hover:to-sky-600 rounded-t-md shadow-2xs transition-all"
                                style={{ height: `${colPercent}%` }}
                                initial={{ height: 0 }}
                                animate={{ height: `${colPercent}%` }}
                                transition={{ duration: 0.8, delay: index * 0.05 + 0.02 }}
                              />
                            </div>

                            {/* Expenses column */}
                            <div className="flex-1 h-full bg-rose-50 rounded-t-md overflow-hidden flex items-end">
                              <motion.div 
                                className="w-full bg-gradient-to-t from-rose-400 to-rose-500 hover:from-rose-500 hover:to-rose-600 rounded-t-md shadow-2xs transition-all"
                                style={{ height: `${expPercent}%` }}
                                initial={{ height: 0 }}
                                animate={{ height: `${expPercent}%` }}
                                transition={{ duration: 0.8, delay: index * 0.05 + 0.04 }}
                              />
                            </div>
                          </div>

                          {/* Label */}
                          <span className="text-[9px] sm:text-[11px] font-medium text-gray-500 mt-2 text-center whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                            {format(new Date(parseInt(item.key.split('-')[0]), parseInt(item.key.split('-')[1]) - 1, 1), 'MMM')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Monthly Material Purchase Expense */}
          <Card className="border-none shadow-sm bg-white rounded-[24px] overflow-hidden flex flex-col justify-between">
            <CardHeader className="p-6 pb-2">
              <CardTitle className="font-serif text-lg md:text-xl flex items-center gap-2.5">
                <TrendingDown size={22} className="text-amber-600" />
                Material Purchases
              </CardTitle>
              <p className="text-xs text-gray-400 font-serif italic mt-1">Expenses breakdown according to stock procurement addition</p>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              {monthlyExpensesList.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400 font-serif italic text-sm">
                  No material purchases recorded in history.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="h-64 flex items-end justify-between gap-3 pt-6 px-1 border-b border-gray-100 relative">
                    {/* Gridlines */}
                    <div className="absolute left-0 right-0 top-1/4 border-t border-dashed border-gray-100 pointer-events-none" />
                    <div className="absolute left-0 right-0 top-2/4 border-t border-dashed border-gray-100 pointer-events-none" />
                    <div className="absolute left-0 right-0 top-3/4 border-t border-dashed border-gray-100 pointer-events-none" />

                    {monthlyExpensesList.map((item, index) => {
                      const maxVal = Math.max(...monthlyExpensesList.map(m => m.expense), 1000);
                      const heightPercent = (item.expense / maxVal) * 100;

                      return (
                        <div key={item.key} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                          {/* Tooltip */}
                          <div className="absolute bottom-full mb-2 bg-slate-900 text-white text-[10px] md:text-xs font-mono font-bold py-2 px-2.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none shadow-xl z-20 text-center whitespace-nowrap border border-slate-800">
                            <div>{item.monthName}</div>
                            <div className="text-amber-400 mt-1">₹{item.expense.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                          </div>

                          {/* Block */}
                          <div className="w-full max-w-[32px] h-full bg-amber-50 rounded-t-md overflow-hidden flex items-end">
                            <motion.div 
                              className="w-full bg-gradient-to-t from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 rounded-t-md shadow-2xs transition-all"
                              style={{ height: `${heightPercent}%` }}
                              initial={{ height: 0 }}
                              animate={{ height: `${heightPercent}%` }}
                              transition={{ duration: 0.8, delay: index * 0.05 }}
                            />
                          </div>

                          {/* Label */}
                          <span className="text-[9px] sm:text-[11px] font-medium text-gray-500 mt-2 text-center whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                            {format(new Date(parseInt(item.key.split('-')[0]), parseInt(item.key.split('-')[1]) - 1, 1), 'MMM')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Market Outstanding by Party */}
        <Card className="border-none shadow-sm bg-white rounded-[24px] overflow-hidden">
          <CardHeader className="p-6 pb-2 flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-50 gap-2">
            <div>
              <CardTitle className="font-serif text-lg md:text-xl flex items-center gap-2.5">
                <FileText size={20} className="text-[#A8201A]" />
                Outstanding Balances - Market Receivables
              </CardTitle>
              <p className="text-xs text-gray-400 font-serif italic mt-0.5">Top client parties sorted by maximum net ledger debit outstanding</p>
            </div>
            <div className="shrink-0 text-left sm:text-right">
              <span className="text-xs bg-red-50 text-[#A8201A] font-mono font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                {partyOutstandingList.length} Active Parties
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {partyOutstandingList.length === 0 ? (
              <div className="py-12 text-center text-gray-400 font-serif italic text-sm">
                Congratulations! No outstanding market balances currently active. All accounts are fully settled.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {partyOutstandingList.slice(0, 10).map((item, index) => {
                  const maxOutstanding = partyOutstandingList[0]?.outstanding || 1;
                  const percentage = (item.outstanding / maxOutstanding) * 100;
                  return (
                    <div key={item.partyName} className="space-y-2 group">
                      <div className="flex justify-between items-center text-xs md:text-sm">
                        <span className="font-semibold text-gray-800 truncate max-w-[200px] sm:max-w-[300px] group-hover:text-amber-900 transition-colors">{item.partyName}</span>
                        <span className="font-mono font-bold text-[#A8201A] text-sm md:text-base">₹{item.outstanding.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                      </div>
                      
                      {/* Visual progress meter */}
                      <div className="w-full bg-red-50 h-3 rounded-full overflow-hidden relative border border-red-100/50">
                        <motion.div 
                          className="bg-gradient-to-r from-red-400 to-[#A8201A] h-full rounded-full"
                          style={{ width: `${percentage}%` }}
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          transition={{ duration: 0.8, delay: index * 0.05 }}
                        />
                      </div>
                      
                      <div className="flex justify-between text-[10px] md:text-xs text-gray-400 font-mono">
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-300" /> Billed: ₹{item.totalBilled.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-300" /> Received: ₹{item.totalPaid.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Business Expenses Tracker */}
      <Card id="business-expenses-tracker" className="border-none shadow-sm bg-white rounded-[24px] overflow-hidden scroll-mt-44 md:scroll-mt-48 mt-8">
        <CardHeader className="p-6 pb-2 border-b border-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <CardTitle className="font-serif text-lg md:text-xl flex items-center gap-2.5">
              <Receipt size={22} className="text-[#5A5A40]" />
              Business Operational Expenses Ledger
            </CardTitle>
            <p className="text-xs text-gray-400 font-serif italic mt-0.5">
              Manage and track salaries, rent, utility bills, and other printing press overhead costs
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Month Filter Selector */}
            <select
              className="bg-gray-50 border border-gray-200 rounded-full px-4 h-10 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] focus:border-[#5A5A40] transition-colors cursor-pointer"
              value={selectedExpenseMonth}
              onChange={(e) => setSelectedExpenseMonth(e.target.value)}
            >
              {expenseMonthsList.map(item => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>

            {/* Add Expense Button */}
            <Button
              onClick={() => {
                setEditingExpense(null);
                setExpenseForm({
                  title: '',
                  amount: '',
                  date: format(new Date(), 'yyyy-MM-dd'),
                  category: 'Miscellaneous / Others',
                  notes: ''
                });
                setIsExpenseDialogOpen(true);
              }}
              className="rounded-full bg-[#5A5A40] text-white hover:bg-[#4a4a34] font-semibold h-10 text-xs flex items-center gap-1.5"
            >
              <Plus size={15} />
              Add Expense
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Monthly Expenditure Summary Cards */}
          <div className="p-5 bg-[#5A5A40]/5 border border-[#5A5A40]/10 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#5A5A40]/80 font-mono">Total Selected Month Expenses</span>
              <p className="text-2xl md:text-3xl font-bold text-gray-900 font-mono mt-1">
                ₹{selectedMonthGeneralTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="text-xs text-gray-500 font-serif italic sm:text-right">
              Based on {filteredExpenses.length} logged expense transaction{filteredExpenses.length === 1 ? '' : 's'}
            </div>
          </div>

          {/* Expenses Table */}
          {filteredExpenses.length === 0 ? (
            <div className="py-12 text-center text-gray-400 font-serif italic text-sm border border-dashed border-gray-150 rounded-2xl bg-gray-50/50">
              No general operational expenses logged for this month. 
              <button 
                onClick={() => {
                  setEditingExpense(null);
                  setExpenseForm({
                    title: '',
                    amount: '',
                    date: format(new Date(), 'yyyy-MM-dd'),
                    category: 'Miscellaneous / Others',
                    notes: ''
                  });
                  setIsExpenseDialogOpen(true);
                }}
                className="text-[#5A5A40] hover:underline font-bold ml-1"
              >
                Add your first expense
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
              <table className="w-full text-left border-collapse text-xs md:text-sm">
                <thead>
                  <tr className="bg-gray-50/75 border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <th className="p-4">Date</th>
                    <th className="p-4">Expense Title</th>
                    <th className="p-4">Category</th>
                    <th className="p-4">Notes</th>
                    <th className="p-4 text-right">Amount</th>
                    <th className="p-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredExpenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-gray-50/25 transition-colors">
                      <td className="p-4 font-mono font-medium text-gray-600">
                        {format(new Date(exp.date), 'dd MMM yyyy')}
                      </td>
                      <td className="p-4 font-medium text-gray-900">
                        {exp.title}
                      </td>
                      <td className="p-4">
                        <span className={`inline-block px-2.5 py-1 text-[10px] font-bold rounded-full border ${CATEGORY_COLORS[exp.category || 'Miscellaneous / Others']}`}>
                          {exp.category || 'Miscellaneous / Others'}
                        </span>
                      </td>
                      <td className="p-4 text-gray-500 max-w-[200px] truncate italic font-serif">
                        {exp.notes || '—'}
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-gray-900 text-base">
                        ₹{exp.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditingExpense(exp);
                              setExpenseForm({
                                title: exp.title,
                                amount: exp.amount.toString(),
                                date: format(new Date(exp.date), 'yyyy-MM-dd'),
                                category: exp.category || 'Miscellaneous / Others',
                                notes: exp.notes || ''
                              });
                              setIsExpenseDialogOpen(true);
                            }}
                            className="h-8 w-8 text-gray-400 hover:text-amber-600 rounded-full"
                          >
                            <Edit size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteExpense(exp.id)}
                            className="h-8 w-8 text-gray-400 hover:text-red-600 rounded-full"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        <Card id="jobs-to-dispatch" className="lg:col-span-2 border-none shadow-sm bg-white rounded-[24px] md:rounded-[32px] overflow-hidden scroll-mt-44 md:scroll-mt-48">
          <CardHeader className="p-6 md:p-8 border-b border-gray-50 flex flex-row items-center justify-between">
            <CardTitle className="font-serif text-lg md:text-xl flex items-center gap-2">
              <Truck size={20} className="text-[#5A5A40]" />
              Jobs to be Dispatched
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-50">
              {pendingJobs.map((job) => {
                const totalShipped = job.dispatches?.reduce((sum, d) => sum + d.quantityShipped, 0) || 0;
                const orderedQty = Number(job.orderedQuantity) || 0;
                const percent = orderedQty > 0 ? Math.min(Math.round((totalShipped / orderedQty) * 100), 100) : 0;
                const isPartial = job.dispatchStatus === 'partial';

                return (
                  <div key={job.id} className="p-4 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-start gap-3 md:gap-4 min-w-0">
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
                        <FileText size={18} className="md:w-5 md:h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-bold uppercase">
                            #{getJobCode(job, allJobs)}
                          </span>
                          <p className="font-medium text-gray-900 truncate">{job.clientName}</p>
                        </div>
                        <p className="text-xs md:text-sm text-gray-500 truncate max-w-[200px] sm:max-w-[300px] md:max-w-md mt-0.5">{job.jobDescription}</p>
                        
                        {/* Shipped Progress Summary */}
                        <div className="mt-2.5 flex items-center gap-3">
                          <div className="w-32 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${isPartial ? 'bg-amber-400' : 'bg-gray-300'}`}
                              style={{ width: `${orderedQty > 0 ? percent : 0}%` }}
                            />
                          </div>
                          <span className="text-[10px] md:text-xs font-mono text-gray-500">
                            {orderedQty > 0 ? (
                              <span>Shipped: <strong className="text-gray-900">{totalShipped.toLocaleString()}</strong> / {orderedQty.toLocaleString()} pcs ({percent}%)</span>
                            ) : (
                              <span className="italic text-gray-400">Total order size undefined</span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-gray-100/70">
                      <span className={`text-[10px] md:text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                        isPartial ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-slate-50 border border-slate-200 text-slate-500'
                      }`}>
                        {isPartial ? 'Partial' : 'Pending'}
                      </span>
                      <div className="text-right mt-1 font-mono">
                        <p className="text-[10px] md:text-xs text-gray-400">Ordered: {format(job.date, 'dd-MM-yy')}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {pendingJobs.length === 0 && (
                <div className="p-12 text-center text-gray-400 font-serif italic text-sm md:text-base">
                  All current jobs have been completely dispatched. Excellent work!
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card id="low-stock-items" className="border-none shadow-sm bg-white rounded-[24px] md:rounded-[32px] overflow-hidden scroll-mt-44 md:scroll-mt-48">
          <CardHeader className="p-6 md:p-8 border-b border-gray-50">
            <CardTitle className="font-serif text-lg md:text-xl flex items-center gap-2">
              <AlertTriangle size={20} className="text-amber-500" />
              Low Stock Items
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            <div className="space-y-6">
              {/* Paper Section */}
              {lowPaper.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Paper</h4>
                  {lowPaper.map((stock) => (
                    <div key={stock.id} className="flex items-center justify-between p-3 md:p-4 bg-blue-50/50 rounded-2xl border border-blue-100/50">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{stock.name}</p>
                        <p className="text-[10px] md:text-xs text-blue-600 font-medium uppercase tracking-wider">{stock.gsm} GSM • {stock.size}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base md:text-lg font-mono font-bold text-blue-700">{stock.quantity}</p>
                        <p className="text-[8px] md:text-[10px] text-blue-600 uppercase font-bold">Sheets Left</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Board Section */}
              {lowBoard.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Board</h4>
                  {lowBoard.map((stock) => (
                    <div key={stock.id} className="flex items-center justify-between p-3 md:p-4 bg-amber-50/50 rounded-2xl border border-amber-100/50">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{stock.name}</p>
                        <p className="text-[10px] md:text-xs text-amber-600 font-medium uppercase tracking-wider">{stock.gsm} GSM • {stock.size}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base md:text-lg font-mono font-bold text-amber-700">{stock.quantity}</p>
                        <p className="text-[8px] md:text-[10px] text-amber-600 uppercase font-bold">Sheets Left</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Ink Section */}
              {lowInk.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Ink</h4>
                  {lowInk.map((stock) => {
                    const totalContainers = stock.inkContainers?.reduce((acc, c) => acc + c.count, 0) || 0;
                    return (
                      <div key={stock.id} className="flex items-center justify-between p-3 md:p-4 bg-purple-50/50 rounded-2xl border border-purple-100/50">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">{stock.name}</p>
                          <p className="text-[10px] md:text-xs text-purple-600 font-medium uppercase tracking-wider">{stock.quantity} kg</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-base md:text-lg font-mono font-bold text-purple-700">{totalContainers}</p>
                          <p className="text-[8px] md:text-[10px] text-purple-600 uppercase font-bold">Containers Left</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Plates Section */}
              {lowPlates.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Plates</h4>
                  {lowPlates.map((stock) => (
                    <div key={stock.id} className="flex items-center justify-between p-3 md:p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100/50">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{stock.name}</p>
                        <p className="text-[10px] md:text-xs text-emerald-600 font-medium uppercase tracking-wider">{stock.size}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base md:text-lg font-mono font-bold text-emerald-700">{stock.quantity}</p>
                        <p className="text-[8px] md:text-[10px] text-emerald-600 uppercase font-bold">Units Left</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {totalLowStock === 0 && (
                <div className="text-center py-8 text-gray-400 font-serif italic">
                  All stocks are healthy.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {isClearConfirmOpen && (
        <Dialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Clear Activity Logs</DialogTitle>
            </DialogHeader>
            <div className="py-6">
              <p className="text-gray-600">
                Are you sure you want to permanently clear the recent activity history? 
                This will delete <span className="font-bold text-gray-900">all job orders</span> from the database. This action is irreversible.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setIsClearConfirmOpen(false)} className="rounded-full" disabled={isClearing}>Cancel</Button>
              <Button variant="destructive" onClick={handleClearActivity} className="rounded-full px-8 font-serif" disabled={isClearing}>
                {isClearing ? 'Clearing...' : 'Clear Activity'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Expense Modal Dialog */}
      {isExpenseDialogOpen && (
        <Dialog open={isExpenseDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setIsExpenseDialogOpen(false);
            setEditingExpense(null);
          }
        }}>
          <DialogContent className="sm:max-w-[480px] rounded-[32px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                <Receipt className="text-[#5A5A40]" />
                {editingExpense ? 'Edit Expense Record' : 'Log New Expense'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveExpense} className="space-y-4 py-4">
              {/* Expense Title */}
              <div className="space-y-1.5">
                <label htmlFor="expense-title" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold block">Title / Purpose *</label>
                <input
                  id="expense-title"
                  required
                  placeholder="e.g. Office Rent, June Salaries, Electricity Bill"
                  value={expenseForm.title}
                  onChange={(e) => setExpenseForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 h-11 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] focus:border-[#5A5A40]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Amount */}
                <div className="space-y-1.5">
                  <label htmlFor="expense-amount" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold block">Amount (₹) *</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-semibold">₹</span>
                    <input
                      id="expense-amount"
                      type="number"
                      min="0.01"
                      step="any"
                      required
                      placeholder="0.00"
                      value={expenseForm.amount}
                      onChange={(e) => setExpenseForm(prev => ({ ...prev, amount: e.target.value }))}
                      className="w-full bg-white border border-gray-200 rounded-xl pl-8 pr-4 h-11 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] focus:border-[#5A5A40] font-mono font-bold"
                    />
                  </div>
                </div>

                {/* Date */}
                <div className="space-y-1.5">
                  <label htmlFor="expense-date" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold block">Transaction Date *</label>
                  <input
                    id="expense-date"
                    type="date"
                    required
                    value={expenseForm.date}
                    onChange={(e) => setExpenseForm(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 h-11 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] focus:border-[#5A5A40]"
                  />
                </div>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <label htmlFor="expense-category" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold block">Category *</label>
                <select
                  id="expense-category"
                  value={expenseForm.category}
                  onChange={(e) => setExpenseForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 h-11 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] focus:border-[#5A5A40] cursor-pointer"
                >
                  {EXPENSE_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label htmlFor="expense-notes" className="text-[11px] uppercase tracking-wider text-gray-500 font-bold block">Notes / Reference</label>
                <textarea
                  id="expense-notes"
                  placeholder="Invoice number, payment method details, or extra notes..."
                  value={expenseForm.notes}
                  onChange={(e) => setExpenseForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm text-gray-700 h-20 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] focus:border-[#5A5A40] resize-none"
                />
              </div>

              <DialogFooter className="pt-4 gap-2 sm:gap-0">
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={() => {
                    setIsExpenseDialogOpen(false);
                    setEditingExpense(null);
                  }} 
                  className="rounded-full"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="rounded-full bg-[#5A5A40] text-white hover:bg-[#4a4a34] px-8 font-semibold"
                >
                  {editingExpense ? 'Save Changes' : 'Log Expense'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, color, highlight = false, onClick }: any) {
  return (
    <motion.div 
      whileHover={{ y: -4 }} 
      transition={{ duration: 0.2 }}
      onClick={onClick}
      className={onClick ? "cursor-pointer" : ""}
    >
      <Card className={`border-none shadow-sm rounded-[20px] md:rounded-[24px] overflow-hidden ${highlight ? 'ring-2 ring-amber-500/20' : ''} ${onClick ? 'hover:shadow-md transition-all active:scale-[0.98]' : ''}`}>
        <CardContent className="p-4 md:p-6">
          <div className="flex justify-between items-start mb-2 md:mb-4">
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl ${color} flex items-center justify-center`}>
              {React.cloneElement(icon as React.ReactElement, { 
                size: 20, 
                className: ((icon as any).props.className || "") + " md:w-6 md:h-6" 
              } as any)}
            </div>
          </div>
          <h3 className="text-gray-500 text-[10px] md:text-sm font-serif italic mb-0.5 md:mb-1">{title}</h3>
          <p className="text-xl md:text-3xl font-bold text-gray-900 mb-0.5 md:mb-1">{value}</p>
          <p className="text-[10px] md:text-xs text-gray-400">{subtitle}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
