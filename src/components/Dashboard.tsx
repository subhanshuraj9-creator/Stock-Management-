import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, orderBy, onSnapshot, getDocs, writeBatch } from 'firebase/firestore';
import { StockItem, Job, Payment, StockHistory, JointRun } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Package, FileText, AlertTriangle, TrendingUp, Clock, ArrowRight, Trash2, Truck, IndianRupee, ArrowUpRight, BarChart3, TrendingDown } from 'lucide-react';
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

export function Dashboard() {
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [rawJobs, setRawJobs] = useState<Job[]>([]);
  const [jointRuns, setJointRuns] = useState<JointRun[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const allJobs = React.useMemo(() => {
    return synchronizeJobsData(rawJobs, jointRuns);
  }, [rawJobs, jointRuns]);
  const [history, setHistory] = useState<StockHistory[]>([]);
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

  useEffect(() => {
    const stocksUnsubscribe = onSnapshot(collection(db, 'stocks'), (snapshot) => {
      setStocks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockItem)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'stocks');
    });

    const jobsQ = query(collection(db, 'jobs'), orderBy('date', 'desc'));
    const jobsUnsubscribe = onSnapshot(jobsQ, (snapshot) => {
      setRawJobs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'jobs');
    });

    const jointRunsUnsubscribe = onSnapshot(collection(db, 'jointRuns'), (snapshot) => {
      setJointRuns(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JointRun)));
    }, (error) => {
      // ignore
    });

    const paymentsUnsubscribe = onSnapshot(collection(db, 'payments'), (snapshot) => {
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'payments');
    });

    const historyUnsubscribe = onSnapshot(collection(db, 'stockHistory'), (snapshot) => {
      setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockHistory)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'stockHistory');
    });

    return () => {
      stocksUnsubscribe();
      jobsUnsubscribe();
      jointRunsUnsubscribe();
      paymentsUnsubscribe();
      historyUnsubscribe();
    };
  }, []);

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
    const revenueData: { [key: string]: { revenue: number; collections: number } } = {};

    allJobs.forEach(job => {
      const totalDebit = computeJobDebit(job, allJobs, stocks);
      const dateObj = new Date(job.date);
      const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

      if (!revenueData[key]) {
        revenueData[key] = { revenue: 0, collections: 0 };
      }
      revenueData[key].revenue += totalDebit;
    });

    payments.forEach(p => {
      const dateObj = new Date(p.date);
      const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

      if (!revenueData[key]) {
        revenueData[key] = { revenue: 0, collections: 0 };
      }
      revenueData[key].collections += p.amount;
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
        collections: revenueData[key].collections
      };
    });
  }, [allJobs, payments, stocks]);

  const totalOutstandingMarketValue = partyOutstandingList.reduce((sum, p) => sum + p.outstanding, 0);

  const totalSheets = stocks.filter(s => s.type === 'paper' || s.type === 'board').reduce((acc, s) => acc + s.quantity, 0);
  
  const lowPaper = stocks.filter(s => s.type === 'paper' && s.quantity < 500);
  const lowBoard = stocks.filter(s => s.type === 'board' && s.quantity < 500);
  const lowInk = stocks.filter(s => s.type === 'ink' && (s.inkContainers?.reduce((acc, c) => acc + c.count, 0) || 0) < 10);
  const lowPlates = stocks.filter(s => s.type === 'plate' && s.quantity < 10);
  
  const totalLowStock = lowPaper.length + lowBoard.length + lowInk.length + lowPlates.length;
  const pendingJobs = allJobs.filter(job => job.dispatchStatus !== 'completed');

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
                  Monthly Ledger Revenue vs Collections
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
                </div>
              </div>
              <p className="text-xs text-gray-400 font-serif italic mt-1">Comparison of overall billed printing jobs versus payments collected</p>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              {monthlyRevenueList.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-gray-400 font-serif italic text-sm">
                  No billing or receipt activity loaded to plot.
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
                        ...monthlyRevenueList.map(m => Math.max(m.revenue, m.collections)),
                        1000
                      );
                      const revPercent = (item.revenue / maxVal) * 100;
                      const colPercent = (item.collections / maxVal) * 100;

                      return (
                        <div key={item.key} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                          {/* Tooltip */}
                          <div className="absolute bottom-full mb-2 bg-slate-900 text-white text-[10px] md:text-xs font-mono font-bold py-2.5 px-3 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none shadow-xl z-20 text-left min-w-[170px] border border-slate-800">
                            <div className="font-serif italic font-medium pb-1.5 border-b border-slate-800 text-gray-300">{item.monthName}</div>
                            <div className="text-emerald-400 pt-1.5 flex justify-between gap-4">
                              <span>Revenue:</span>
                              <span>₹{item.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            </div>
                            <div className="text-sky-400 mt-1 flex justify-between gap-4">
                              <span>Payments:</span>
                              <span>₹{item.collections.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            </div>
                          </div>

                          {/* Columns */}
                          <div className="flex items-end gap-1.5 w-full h-full max-w-[50px]">
                            {/* Revenue column */}
                            <div className="flex-1 h-full bg-emerald-50 rounded-t-lg overflow-hidden flex items-end">
                              <motion.div 
                                className="w-full bg-gradient-to-t from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 rounded-t-lg shadow-2xs transition-all"
                                style={{ height: `${revPercent}%` }}
                                initial={{ height: 0 }}
                                animate={{ height: `${revPercent}%` }}
                                transition={{ duration: 0.8, delay: index * 0.05 }}
                              />
                            </div>
                            
                            {/* Collection column */}
                            <div className="flex-1 h-full bg-sky-50 rounded-t-lg overflow-hidden flex items-end">
                              <motion.div 
                                className="w-full bg-gradient-to-t from-sky-400 to-sky-500 hover:from-sky-500 hover:to-sky-600 rounded-t-lg shadow-2xs transition-all"
                                style={{ height: `${colPercent}%` }}
                                initial={{ height: 0 }}
                                animate={{ height: `${colPercent}%` }}
                                transition={{ duration: 0.8, delay: index * 0.05 + 0.03 }}
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
