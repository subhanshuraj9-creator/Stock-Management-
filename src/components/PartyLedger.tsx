import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, addDoc, query, orderBy, deleteDoc, doc, writeBatch, setDoc } from 'firebase/firestore';
import { Job, StockItem, Payment, JointRun, PartyOpeningBalance } from '../types';
import { useFirebaseData } from '../contexts/FirebaseDataContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Plus, Search, BookOpen, IndianRupee, ArrowDownCircle, ArrowUpCircle, Trash2, Calendar, FileText, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { getJobCode } from '../lib/utils';
import { format } from 'date-fns';

const ACCENT_COLORS: Record<string, { primary: string; light: string; border: string }> = {
  original: { primary: '#5a5a40', light: '#fafaf5', border: '#e9e9db' },
  blue: { primary: '#1e3a8a', light: '#eff6ff', border: '#dbeafe' },
  green: { primary: '#065f46', light: '#ecfdf5', border: '#d1fae5' },
  crimson: { primary: '#991b1b', light: '#fef2f2', border: '#fee2e2' },
  charcoal: { primary: '#374151', light: '#f9fafb', border: '#f3f4f6' }
};

const LAYOUT_THEMES: Record<string, { fontFamily: string; bodyFont: string }> = {
  classic: { 
    fontFamily: "Garamond, Georgia, 'Times New Roman', serif", 
    bodyFont: "'Inter', sans-serif" 
  },
  modern: { 
    fontFamily: "'Inter', sans-serif", 
    bodyFont: "'Inter', sans-serif" 
  },
  elegant: { 
    fontFamily: "'Playfair Display', serif", 
    bodyFont: "'Inter', sans-serif" 
  },
  compact: { 
    fontFamily: "'JetBrains Mono', Courier, monospace", 
    bodyFont: "'JetBrains Mono', monospace" 
  }
};

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

export function PartyLedger() {
  const {
    jobs: rawJobs,
    jointRuns,
    stocks,
    payments,
    partyOpeningBalances,
  } = useFirebaseData();
  const [isOpeningBalanceOpen, setIsOpeningBalanceOpen] = useState(false);
  const [openingBalanceForm, setOpeningBalanceForm] = useState({
    amount: '',
    type: 'debit' as 'debit' | 'credit'
  });

  const jobs = useMemo(() => {
    return synchronizeJobsData(rawJobs, jointRuns);
  }, [rawJobs, jointRuns]);
  const [selectedParty, setSelectedParty] = useState<string>('');
  const [isPartiesMobileExpanded, setIsPartiesMobileExpanded] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [showConfig, setShowConfig] = useState<boolean>(false);

  // User PDF dynamic theme options
  const [layoutTheme, setLayoutTheme] = useState<string>(() => localStorage.getItem('pdf_layout_theme') || 'classic');
  const [accentColor, setAccentColor] = useState<string>(() => localStorage.getItem('pdf_accent_color') || 'original');
  const [headerMode, setHeaderMode] = useState<string>(() => localStorage.getItem('pdf_header_mode') || 'full_header');
  const [showSignature, setShowSignature] = useState<boolean>(() => {
    const saved = localStorage.getItem('pdf_show_signature');
    return saved !== null ? saved === 'true' : true;
  });
  const [showTerms, setShowTerms] = useState<boolean>(() => {
    const saved = localStorage.getItem('pdf_show_terms');
    return saved !== null ? saved === 'true' : true;
  });

  const [showDetailedLedger, setShowDetailedLedger] = useState<boolean>(() => {
    const saved = localStorage.getItem('pdf_show_detailed_ledger');
    return saved !== null ? saved === 'true' : true;
  });

  const [pressDetails, setPressDetails] = useState(() => {
    const saved = localStorage.getItem('press_details');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback
      }
    }
    return {
      name: 'ROYAL ART PRINTING PRESS',
      address: 'Industrial Press Zone, Phase-1, New Delhi-110020',
      phone: '+91 98100 XXXXX / +91 94112 XXXXX',
      email: 'info@royalartpress.com',
      invoicePrefix: 'RAP-2026-',
      gstNumber: '07AAAAA1111A1Z1'
    };
  });

  // Keep localStorage in sync when fields change
  useEffect(() => {
    localStorage.setItem('press_details', JSON.stringify(pressDetails));
  }, [pressDetails]);

  // Synchronize dynamic keys from localStorage on mount in case edited in InvoiceModal
  useEffect(() => {
    const savedTheme = localStorage.getItem('pdf_layout_theme');
    if (savedTheme) setLayoutTheme(savedTheme);
    
    const savedColor = localStorage.getItem('pdf_accent_color');
    if (savedColor) setAccentColor(savedColor);
    
    const savedHeader = localStorage.getItem('pdf_header_mode');
    if (savedHeader) setHeaderMode(savedHeader);
    
    const savedSig = localStorage.getItem('pdf_show_signature');
    if (savedSig !== null) setShowSignature(savedSig === 'true');
    
    const savedTerms = localStorage.getItem('pdf_show_terms');
    if (savedTerms !== null) setShowTerms(savedTerms === 'true');

    const savedPress = localStorage.getItem('press_details');
    if (savedPress) {
      try {
        setPressDetails(JSON.parse(savedPress));
      } catch (e) {
        // ignore
      }
    }
  }, [showConfig]);

  const updateLedgerSetting = (key: string, value: any) => {
    if (key === 'layoutTheme') {
      setLayoutTheme(value);
      localStorage.setItem('pdf_layout_theme', value);
    } else if (key === 'accentColor') {
      setAccentColor(value);
      localStorage.setItem('pdf_accent_color', value);
    } else if (key === 'headerMode') {
      setHeaderMode(value);
      localStorage.setItem('pdf_header_mode', value);
    } else if (key === 'showSignature') {
      setShowSignature(value);
      localStorage.setItem('pdf_show_signature', value ? 'true' : 'false');
    } else if (key === 'showTerms') {
      setShowTerms(value);
      localStorage.setItem('pdf_show_terms', value ? 'true' : 'false');
    }
  };

  const handleDownloadCSV = () => {
    if (!selectedParty) return;
    const { transactions, openingBalance, totalBilled, totalPaid, balance } = getLedgerStatement(selectedParty, startDate, endDate);

    let csvContent = "";
    csvContent += `Ledger Statement for ${selectedParty}\n`;
    if (startDate || endDate) {
      csvContent += `Period: ${startDate || 'Beginning'} to ${endDate || 'Present'}\n`;
    }
    csvContent += "\n";
    csvContent += "Date,Type,Particulars,Debit (+),Credit (-),Running Balance\n";

    if (startDate || openingBalance !== 0) {
      const dateStr = startDate ? format(new Date(startDate + 'T00:00:00'), 'dd-MM-yy') : '—';
      const label = startDate ? 'Balance Brought Forward (Opening)' : 'Opening Balance (Past Dues/Advance)';
      csvContent += `"${dateStr}","OPENING","${label}","-","-","INR ${openingBalance.toFixed(2)}"\n`;
    }

    const chronological = [...transactions].reverse();
    chronological.forEach(t => {
      const dateStr = format(new Date(t.date), 'dd-MM-yy');
      const typeStr = t.type === 'debit' ? 'JOB BILL' : 'RECEIPT';
      const titleEscaped = t.title.replace(/"/g, '""');
      const detailsJoin = (showDetailedLedger || t.type === 'credit') ? (t.details || []).join(' | ').replace(/"/g, '""') : '';
      const fullTitle = detailsJoin ? `${titleEscaped} (${detailsJoin})` : titleEscaped;
      const debitStr = t.type === 'debit' ? t.amount.toFixed(2) : '-';
      const creditStr = t.type === 'credit' ? t.amount.toFixed(2) : '-';
      const balanceStr = t.balance.toFixed(2);
      
      csvContent += `"${dateStr}","${typeStr}","${fullTitle}","${debitStr}","${creditStr}","${balanceStr}"\n`;
    });

    csvContent += `\n"Summary","Period Billed: INR ${totalBilled.toFixed(2)}","Period Received: INR ${totalPaid.toFixed(2)}","Ending Period Balance: INR ${balance.toFixed(2)}"\n`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Ledger_${selectedParty.replace(/\s+/g, '_')}_${startDate || 'start'}_to_${endDate || 'end'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("CSV Statement downloaded successfully");
  };

  const handlePrintPDF = () => {
    if (!selectedParty) return;
    const { transactions, openingBalance, totalBilled, totalPaid, balance } = getLedgerStatement(selectedParty, startDate, endDate);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Popup blocked! Please allow popups to generate statement documents.");
      return;
    }

    const activeColor = ACCENT_COLORS[accentColor] || ACCENT_COLORS.original;
    const activeTheme = LAYOUT_THEMES[layoutTheme] || LAYOUT_THEMES.classic;

    const dateRangeStr = startDate || endDate 
      ? `Period: ${startDate ? format(new Date(startDate + 'T00:00:00'), 'dd-MM-yy') : 'Beginning'} to ${endDate ? format(new Date(endDate + 'T23:59:59'), 'dd-MM-yy') : 'Present'}`
      : 'Full Ledger Accounts';

    const itemsRows = [...transactions].reverse().map(tr => `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 7px 12px; font-family: monospace; font-size: 11px; color: #4a5568;">
          ${format(new Date(tr.date), 'dd-MM-yy')}
        </td>
        <td style="padding: 7px 12px; font-size: 11px; font-weight: 600;">
          <span style="display: inline-block; padding: 1.5px 6px; border-radius: 4px; font-size: 10px; ${
            tr.type === 'debit' 
              ? 'background-color: #fee2e2; color: #991b1b; border: 1px solid rgba(153,27,27,0.1);' 
              : 'background-color: #d1fae5; color: #065f46; border: 1px solid rgba(6,95,70,0.1);'
          }">
            ${tr.type === 'debit' ? 'JOB BILL' : 'RECEIPT'}
          </span>
        </td>
        <td style="padding: 7px 12px; font-size: 11.5px; color: #1a202c;">
          <div style="font-weight: 600; color: #2d3748;">${tr.title}</div>
          ${(showDetailedLedger || tr.type === 'credit') && tr.details && tr.details.length > 0 ? `
            <div style="font-size: 9.5px; color: #718096; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;">
              ${tr.details.map(d => `<span style="background-color: #f7fafc; border: 1px solid #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 8.5px; font-family: sans-serif; white-space: normal;">${d}</span>`).join('')}
            </div>
          ` : ''}
        </td>
        <td style="padding: 7px 12px; text-align: right; font-family: monospace; font-size: 11.5px; color: #e53e3e; font-weight: 500;">
          ${tr.type === 'debit' ? `₹${tr.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
        </td>
        <td style="padding: 7px 12px; text-align: right; font-family: monospace; font-size: 11.5px; color: #38a169; font-weight: 500;">
          ${tr.type === 'credit' ? `₹${tr.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
        </td>
        <td style="padding: 7px 12px; text-align: right; font-family: monospace; font-size: 11.5px; font-weight: 600; color: ${tr.balance > 0 ? '#dd6b20' : tr.balance < 0 ? '#3182ce' : '#2d3748'};">
          ₹${tr.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
      </tr>
    `).join('');

    const openingBalanceRow = (startDate || openingBalance !== 0) ? `
      <tr style="border-bottom: 1px solid var(--border-color); background-color: var(--light-bg);">
        <td style="padding: 7px 12px; font-family: monospace; font-size: 11px; color: #718096;">
          ${startDate ? format(new Date(startDate + 'T00:00:00'), 'dd-MM-yy') : '—'}
        </td>
        <td style="padding: 7px 12px; font-size: 11px; font-weight: bold; color: #4a5568;">
          OPENING
        </td>
        <td style="padding: 7px 12px; font-size: 11.5px; font-weight: bold; color: #4a5568; font-style: italic;">
          ${startDate ? 'Balance Brought Forward (Opening)' : 'Opening Balance (Past Dues/Advance)'}
        </td>
        <td style="padding: 7px 12px; text-align: right;">-</td>
        <td style="padding: 7px 12px; text-align: right;">-</td>
        <td style="padding: 7px 12px; text-align: right; font-family: monospace; font-size: 11.5px; font-weight: bold; color: ${openingBalance > 0 ? '#dd6b20' : openingBalance < 0 ? '#3182ce' : '#4a5568'};">
          ₹${openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
      </tr>
    ` : '';

    printWindow.document.write(`
      <html>
        <head>
          <title>${selectedParty} - Ledger Statement</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;600;700&display=swap');
            
            :root {
              --primary: ${activeColor.primary};
              --light-bg: ${activeColor.light};
              --border-color: ${activeColor.border};
              --font-display: ${activeTheme.fontFamily};
              --font-body: ${activeTheme.bodyFont};
            }

            body {
              font-family: var(--font-body);
              color: #2d3748;
              background: #ffffff;
              padding: 30px;
              margin: 0;
            }
            .header {
              border-bottom: ${headerMode === 'letterhead' ? 'none' : '2.5px solid var(--primary)'};
              padding-bottom: 12px;
              margin-bottom: 18px;
            }
            .company-name {
              font-family: var(--font-display);
              font-size: 20px;
              font-weight: 700;
              color: var(--primary);
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .title {
              font-family: var(--font-display);
              font-size: 22px;
              font-weight: 700;
              color: var(--primary);
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .meta-grid {
              display: flex;
              justify-content: space-between;
              gap: 20px;
              margin-bottom: 20px;
              font-size: 12px;
              border-bottom: 1px solid var(--border-color);
              padding-bottom: 12px;
            }
            .meta-block p {
              margin: 3px 0;
            }
            .summary-cards {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr;
              gap: 12px;
              margin-bottom: 20px;
            }
            .card {
              border: 1px solid var(--border-color);
              border-radius: ${layoutTheme === 'modern' ? '12px' : '0px'};
              padding: 10px 14px;
            }
            .card-title {
              font-size: 10px;
              color: #4a5568;
              text-transform: uppercase;
              font-weight: 700;
              margin: 0 0 4px 0;
              letter-spacing: 0.5px;
            }
            .card-amount {
              font-size: 16px;
              font-weight: 700;
              margin: 0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 20px;
            }
            th {
              background-color: var(--primary);
              color: #ffffff;
              font-size: 10.5px;
              text-transform: uppercase;
              letter-spacing: 0.8px;
              text-align: left;
              padding: 8px 12px;
              border-bottom: 2px solid var(--border-color);
            }
            .footer {
              text-align: center;
              font-size: 10px;
              color: #718096;
              margin-top: 30px;
              border-top: 1px solid var(--border-color);
              padding-top: 15px;
              line-height: 1.4;
            }
            .sign-section {
              display: flex;
              justify-content: ${showTerms ? 'space-between' : 'flex-end'};
              align-items: flex-end;
              margin-top: 30px;
            }
            .stamp-signature {
              border-top: 1.5px solid var(--primary);
              width: 200px;
              text-align: center;
              padding-top: 8px;
              font-size: 12px;
              font-weight: 500;
              color: #4a5568;
            }
            @page {
              size: auto;
              margin: 0mm;
            }
            @media print {
              body {
                padding: 12mm 15mm !important;
              }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="no-print" style="margin-bottom: 20px; text-align: right;">
            <button onclick="window.print();" style="background-color: var(--primary); color: white; border: none; padding: 11px 22px; font-size: 14px; border-radius: 20px; cursor: pointer; font-family: inherit; font-weight: 500; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
              🖨️ Click / Print to Save as PDF
            </button>
          </div>

          ${headerMode === 'letterhead' ? `
            <div style="height: 140px; display: flex; align-items: flex-end; justify-content: flex-end; margin-bottom: 20px; border-bottom: 1px dashed var(--border-color);">
              <span style="font-size: 10px; color:#a0aec0; margin-bottom: 4px; font-family: monospace;">PRE-PRINTED LETTERHEAD SPACE</span>
            </div>
          ` : ''}

          <div class="header" style="display: flex; justify-content: space-between; align-items: flex-end;">
            ${headerMode === 'full_header' ? `
              <div style="text-align: left;">
                <div class="company-name" style="font-size: 18.5px; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px; font-family: var(--font-display);">${pressDetails.name}</div>
                <div style="font-size: 11px; color: #4a5568; margin-top: 4px; line-height: 1.4; font-family: var(--font-body);">
                  ${pressDetails.address}<br/>
                  Phone: ${pressDetails.phone} | Email: ${pressDetails.email}
                  ${pressDetails.gstNumber ? `<br/><strong>GSTIN:</strong> ${pressDetails.gstNumber}` : ''}
                </div>
              </div>
            ` : `<div>&nbsp;</div>`}
            
            <div style="text-align: right; min-width: 250px; ${headerMode === 'letterhead' ? 'margin-top: -10px;' : ''}">
              <div style="font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--primary); letter-spacing: 0.5px; text-transform: uppercase;">LEDGER STATEMENT</div>
              <div style="font-size: 11px; color: #718096; margin-top: 2px;">
                Account Register Trace
              </div>
            </div>
          </div>

          <div class="meta-grid" style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 12px; gap: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px;">
            <div style="text-align: left;">
              <span style="font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #718096; display: block; margin-bottom: 3px;">Statement Prepared For:</span>
              <span style="font-size: 15px; font-weight: 700; color: #1a202c; font-family: var(--font-display);">${selectedParty}</span>
              <span style="display: block; font-size: 10px; color: #718096; margin-top: 2px;">Active Client Ledger Accounts</span>
            </div>
            
            <div style="text-align: right;">
              <span style="font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #718096; display: block; margin-bottom: 3px;">Statement Period Range:</span>
              <span style="font-size: 12px; font-weight: 600; color: #2d3748; font-family: monospace;">${dateRangeStr}</span>
              <span style="display: block; font-size: 10px; color: #718096; margin-top: 2px;">Generated on: ${format(new Date(), 'dd-MM-yy')}</span>
            </div>
          </div>

          <div class="summary-cards">
            <div class="card" style="border-left: 3.5px solid #f56565; background-color: #fff5f5;">
              <h4 class="card-title" style="color: #c53030;">Debits added in period</h4>
              <p class="card-amount" style="color: #c53030;">₹${totalBilled.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div class="card" style="border-left: 3.5px solid #48bb78; background-color: #f0fff4;">
              <h4 class="card-title" style="color: #22543d;">Credits paid in period</h4>
              <p class="card-amount" style="color: #22543d;">₹${totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div class="card" style="border-left: 3.5px solid var(--primary); background-color: var(--light-bg);">
              <h4 class="card-title" style="color: var(--primary);">Closing Period Outstanding</h4>
              <p class="card-amount" style="color: var(--primary);">₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 110px;">Date</th>
                <th style="width: 90px;">Voucher</th>
                <th>Particulars</th>
                <th style="width: 110px; text-align: right;">Debit (₹)</th>
                <th style="width: 110px; text-align: right;">Credit (₹)</th>
                <th style="width: 120px; text-align: right;">Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${openingBalanceRow}
              ${itemsRows}
            </tbody>
          </table>

          <div style="display: flex; justify-content: flex-end; margin-top: 15px;">
            <table style="width: 320px; border-collapse: collapse; margin-bottom: 20px; border: 1px solid var(--border-color); font-size: 11.5px; border-radius: 8px;">
              <tr style="border-bottom: 1px solid var(--border-color); background-color: #fafaf9;">
                <td style="padding: 7px 10px; color: #4a5568; font-weight: 600;">Opening balance:</td>
                <td style="padding: 7px 10px; text-align: right; font-family: monospace; font-weight: 600; color: #2d3748;">₹${openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              <tr style="border-bottom: 1px solid var(--border-color); color: #991b1b;">
                <td style="padding: 7px 10px; font-weight: 600;">(+) Total Job Bills:</td>
                <td style="padding: 7px 10px; text-align: right; font-family: monospace; font-weight: 600;">₹${totalBilled.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              <tr style="border-bottom: 1px solid var(--border-color); color: #065f46;">
                <td style="padding: 7px 10px; font-weight: 600;">(-) Total Received:</td>
                <td style="padding: 7px 10px; text-align: right; font-family: monospace; font-weight: 600;">₹${totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              <tr style="background-color: var(--primary); color: white; font-weight: bold; font-size: 13px;">
                <td style="padding: 8px 10px;">Closing Balance Due:</td>
                <td style="padding: 8px 10px; text-align: right; font-family: monospace;">₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </table>
          </div>

          <div class="sign-section">
            ${showTerms ? `
              <div style="max-width: 60%; font-size: 10.5px; color:#718096; line-height: 1.45; text-align: left;">
                <strong>Statement Explanatory Notes:</strong><br/>
                1. This represents an active chronological trace of reconciled debits/credits outstanding.<br/>
                2. Balance matches of transactions copy are computer generated ledger values on demand.
              </div>
            ` : '<div>&nbsp;</div>'}

            ${showSignature ? `
              <div class="stamp-signature">
                For <strong>${pressDetails.name}</strong><br/><br/><br/>
                Authorized Signatory
              </div>
            ` : ''}
          </div>

          <div class="footer">
            <p>${pressDetails.name} • Business Statement of Account</p>
            <p style="font-size: 10px; color: #a0aec0; margin-top: 4px;">This document represents a copy of verified billing ledgers from account registers.</p>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 400);
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleClearPayments = async () => {
    setIsClearing(true);
    try {
      const batch = writeBatch(db);
      payments.forEach(p => {
        batch.delete(doc(db, 'payments', p.id));
      });
      await batch.commit();
      toast.success('All payment receipt credentials cleared successfully');
      setIsClearConfirmOpen(false);
    } catch (error) {
      console.error(error);
      toast.error('Failed to clear payments history');
    } finally {
      setIsClearing(false);
    }
  };

  const [paymentForm, setPaymentForm] = useState({
    clientName: '',
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    notes: ''
  });

  // Gather unique parties
  const uniqueParties = Array.from(new Set([
    ...jobs.map(j => j.clientName.trim()),
    ...payments.map(p => p.clientName.trim()),
    ...partyOpeningBalances.map(b => b.clientName.trim())
  ])).filter(name => name.length > 0).sort();

  // If no party is selected but parties exist, select the first one
  useEffect(() => {
    if (!selectedParty && uniqueParties.length > 0) {
      setSelectedParty(uniqueParties[0]);
    }
  }, [uniqueParties, selectedParty]);

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.clientName || !paymentForm.amount) {
      toast.error('Please specify the Client Name and Amount');
      return;
    }

    try {
      const payDate = paymentForm.date ? new Date(paymentForm.date).getTime() : Date.now();
      await addDoc(collection(db, 'payments'), {
        clientName: paymentForm.clientName.trim(),
        amount: Number(paymentForm.amount),
        date: payDate,
        notes: paymentForm.notes.trim()
      });

      setIsPaymentOpen(false);
      setPaymentForm({
        clientName: '',
        amount: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        notes: ''
      });
      toast.success('Payment recorded successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'payments');
    }
  };

  const handleDeletePayment = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this payment receipt?')) return;
    try {
      await deleteDoc(doc(db, 'payments', id));
      toast.success('Payment receipt deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `payments/${id}`);
    }
  };

  const handleOpenOpeningBalance = () => {
    if (!selectedParty) return;
    setOpeningBalanceForm({
      amount: customOpeningAmount !== 0 ? Math.abs(customOpeningAmount).toString() : '',
      type: customOpeningAmount >= 0 ? 'debit' : 'credit'
    });
    setIsOpeningBalanceOpen(true);
  };

  const handleSaveOpeningBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedParty) return;

    try {
      const parsedAmount = Number(openingBalanceForm.amount) || 0;
      const finalValue = openingBalanceForm.type === 'credit' ? -parsedAmount : parsedAmount;
      const docId = selectedParty.trim().toLowerCase();
      
      const docRef = doc(db, 'partyOpeningBalances', docId);
      await setDoc(docRef, {
        clientName: selectedParty.trim(),
        openingBalance: finalValue,
        lastUpdated: Date.now()
      });

      setIsOpeningBalanceOpen(false);
      toast.success(`Opening balance updated for ${selectedParty}`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to update opening balance');
    }
  };

  // Compile ledger for selected party
  const getLedgerStatement = (partyName: string, startStr: string, endStr: string) => {
    if (!partyName) return { transactions: [], totalBilled: 0, totalPaid: 0, balance: 0, openingBalance: 0, totalBilledOverall: 0, totalPaidOverall: 0, balanceOverall: 0 };

    const partyJobs = jobs.filter(j => j.clientName.trim().toLowerCase() === partyName.trim().toLowerCase());
    const partyPayments = payments.filter(p => p.clientName.trim().toLowerCase() === partyName.trim().toLowerCase());

    const allTransactions: any[] = [];

    // Process job debit
    partyJobs.forEach(job => {
      // Calculate paper stock material cost first
      const paperStockMaterialCost = (job.items || []).reduce((sum, item) => {
        const sheetsUsed = item.allocatedPaper !== undefined ? item.allocatedPaper : (item.quantityUsed || 0);
        return sum + (sheetsUsed * (item.paperRate || 0));
      }, 0);

      // Determine paperTotal using stored paperBillingAmount or falling back to material cost
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

      const paperDetails: string[] = [];
      // Don't show paper stock names in ledger details as per user request
      if (paperTotal > 0) {
        paperDetails.push(`Paper Billing: ₹${paperTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      }

      let plateTotal = 0;
      const plateDetails: string[] = [];
      const platesToProcess = [...(job.platesUsed || [])];

      if (job.isJoint && job.jointRef) {
        const cleanRef = job.jointRef.trim().toUpperCase().replace('#', '');
        const referencedJob = jobs.find(j => getJobCode(j, jobs) === cleanRef);
        if (referencedJob && referencedJob.platesUsed) {
          referencedJob.platesUsed.filter(p => !p.isCancelled).forEach(refPlate => {
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
        if (plateCost > 0) {
          const stock = stocks.find(s => s.id === plate.plateId);
          const isAdditional = (job.isJoint || (job.jointRef && job.jointRef.trim() !== '')) && !plate.isJoint && !plate.isJointRef;
          const label = isAdditional ? `${stock?.name || 'Plate'} (Addl.)` : (stock?.name || 'Plate');
          plateDetails.push(`Plate: ${label}: ₹${plateCost.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
        }
      });

      let processTotal = 0;
      const processDetails: string[] = [];
      (job.processCharges || []).forEach(pc => {
        if (pc.amount > 0) {
          processTotal += pc.amount;
          processDetails.push(`${pc.name}: ₹${pc.amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
        }
      });

      let laminationTotal = 0;
      const laminationDetails: string[] = [];
      if (job.lamination?.halfEnabled) {
        const halfTotal = (job.lamination.halfQty || 0) * (job.lamination.halfRate || 0);
        if (halfTotal > 0) {
          laminationTotal += halfTotal;
          laminationDetails.push(`Half Lamination: ₹${halfTotal.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
        }
      }
      if (job.lamination?.fullEnabled) {
        const fullTotal = (job.lamination.fullQty || 0) * (job.lamination.fullRate || 0);
        if (fullTotal > 0) {
          laminationTotal += fullTotal;
          laminationDetails.push(`Full Lamination: ₹${fullTotal.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
        }
      }

      const additionalCharges = job.additionalCharges || 0;
      const additionalDetails: string[] = [];
      if (additionalCharges > 0) {
        additionalDetails.push(`Other Charges: ₹${additionalCharges.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      }

      const totalDebit = paperTotal + plateTotal + processTotal + laminationTotal + additionalCharges;

      allTransactions.push({
        id: job.id,
        date: job.date,
        type: 'debit',
        title: job.jobDescription,
        details: [...paperDetails, ...plateDetails, ...processDetails, ...laminationDetails, ...additionalDetails],
        amount: totalDebit,
        reference: job
      });
    });

    // Process payment credit
    partyPayments.forEach(pay => {
      allTransactions.push({
        id: pay.id,
        date: pay.date,
        type: 'credit',
        title: 'Payment Received',
        details: pay.notes ? [pay.notes] : ['Direct account payment received'],
        amount: pay.amount,
        reference: pay
      });
    });

    // Sort chronologically
    allTransactions.sort((a, b) => a.date - b.date);

    const fromTime = startStr ? new Date(startStr + 'T00:00:00').getTime() : null;
    const toTime = endStr ? new Date(endStr + 'T23:59:59').getTime() : null;

    const customBalObj = partyOpeningBalances.find(b => b.clientName.trim().toLowerCase() === partyName.trim().toLowerCase());
    const customOpeningAmount = customBalObj ? customBalObj.openingBalance : 0;

    let openingBalance = customOpeningAmount;
    const priorTransactions = allTransactions.filter(t => fromTime !== null && t.date < fromTime);
    priorTransactions.forEach(t => {
      if (t.type === 'debit') {
        openingBalance += t.amount;
      } else {
        openingBalance -= t.amount;
      }
    });

    const filteredTransactions = allTransactions.filter(t => {
      if (fromTime !== null && t.date < fromTime) return false;
      if (toTime !== null && t.date > toTime) return false;
      return true;
    });

    let rollingBalance = openingBalance;
    let totalBilledPeriod = 0;
    let totalPaidPeriod = 0;

    const balancedTransactions = filteredTransactions.map(t => {
      if (t.type === 'debit') {
        rollingBalance += t.amount;
        totalBilledPeriod += t.amount;
      } else {
        rollingBalance -= t.amount;
        totalPaidPeriod += t.amount;
      }
      return { ...t, balance: rollingBalance };
    });

    // Lifetime values
    let totalBilledOverall = 0;
    let totalPaidOverall = 0;
    let balanceOverall = customOpeningAmount;
    allTransactions.forEach(t => {
      if (t.type === 'debit') {
        totalBilledOverall += t.amount;
        balanceOverall += t.amount;
      } else {
        totalPaidOverall += t.amount;
        balanceOverall -= t.amount;
      }
    });

    return {
      transactions: [...balancedTransactions].reverse(),
      totalBilled: totalBilledPeriod,
      totalPaid: totalPaidPeriod,
      balance: rollingBalance,
      openingBalance,
      totalBilledOverall,
      totalPaidOverall,
      balanceOverall
    };
  };

  const { transactions, totalBilled, totalPaid, balance, openingBalance, totalBilledOverall, totalPaidOverall, balanceOverall } = getLedgerStatement(selectedParty, startDate, endDate);

  const customOpeningAmount = useMemo(() => {
    if (!selectedParty) return 0;
    const customBalObj = partyOpeningBalances.find(b => b.clientName.trim().toLowerCase() === selectedParty.trim().toLowerCase());
    return customBalObj ? customBalObj.openingBalance : 0;
  }, [partyOpeningBalances, selectedParty]);

  const filteredParties = uniqueParties.filter(party => 
    party.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-serif font-medium text-gray-900">Party accounts & Ledger</h2>
          <p className="text-sm md:text-base text-gray-500 font-serif italic">Track billing, payments, and outstanding balances of printing clients</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          {payments.length > 0 && (
            <Button
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50 rounded-full h-12 md:h-10 px-4 flex items-center justify-center gap-2 w-full sm:w-auto shrink-0"
              onClick={() => setIsClearConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              <span>Clear Payment History</span>
            </Button>
          )}
          <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
            <DialogTrigger render={<Button className="bg-[#5A5A40] hover:bg-[#4A4A30] rounded-full px-6 w-full sm:w-auto h-12 md:h-10" />}>
              <Plus className="mr-2 h-4 w-4" /> Record Party Payment
            </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] rounded-[32px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Record Receipt</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddPayment} className="space-y-5 py-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="pay-clientName" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Party / Client Name</Label>
                  <Input 
                    id="pay-clientName" 
                    placeholder="e.g. Acme Pubs" 
                    value={paymentForm.clientName} 
                    onChange={e => setPaymentForm({...paymentForm, clientName: e.target.value})} 
                    required 
                    className="rounded-xl border-gray-200 h-12"
                    list="suggested-parties"
                  />
                  <datalist id="suggested-parties">
                    {uniqueParties.map((p, idx) => (
                      <option key={idx} value={p} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pay-amount" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Amount Paid (₹)</Label>
                  <Input 
                    id="pay-amount" 
                    type="number"
                    step="any"
                    placeholder="0.00" 
                    value={paymentForm.amount} 
                    onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})} 
                    required 
                    className="rounded-xl border-gray-200 h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pay-date" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Payment Date</Label>
                  <Input 
                    id="pay-date" 
                    type="date"
                    value={paymentForm.date} 
                    onChange={e => setPaymentForm({...paymentForm, date: e.target.value})} 
                    required 
                    className="rounded-xl border-gray-200 h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pay-notes" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Receipt Notes / Reference</Label>
                  <Input 
                    id="pay-notes" 
                    placeholder="e.g. Bank Transfer, Ref# 9382" 
                    value={paymentForm.notes} 
                    onChange={e => setPaymentForm({...paymentForm, notes: e.target.value})} 
                    className="rounded-xl border-gray-200 h-12"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="submit" className="bg-[#5A5A40] hover:bg-[#4A4A30] w-full h-12 rounded-full text-lg mt-2">
                  Save Receipt Credit
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={isOpeningBalanceOpen} onOpenChange={setIsOpeningBalanceOpen}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Set Opening Balance</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveOpeningBalance} className="space-y-5 py-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-widest text-gray-400 font-bold block">Party / Client Name</Label>
                  <p className="text-base font-semibold text-gray-800 bg-gray-50/80 px-3 py-2 rounded-xl border border-gray-100">
                    {selectedParty}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="open-amount" className="text-xs uppercase tracking-widest text-gray-400 font-bold">Opening Balance Amount (₹)</Label>
                  <Input 
                    id="open-amount" 
                    type="number"
                    step="any"
                    placeholder="0.00" 
                    value={openingBalanceForm.amount} 
                    onChange={e => setOpeningBalanceForm({...openingBalanceForm, amount: e.target.value})} 
                    required 
                    className="rounded-xl border-gray-200 h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-widest text-gray-400 font-bold block">Balance Type</Label>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <button
                      type="button"
                      onClick={() => setOpeningBalanceForm({...openingBalanceForm, type: 'debit'})}
                      className={`py-3 px-4 rounded-xl border font-semibold text-xs md:text-sm text-center transition-all ${
                        openingBalanceForm.type === 'debit'
                          ? 'bg-red-50 border-red-200 text-red-600 shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Debit / Due
                      <span className="block text-[10px] font-normal text-gray-400 mt-0.5 font-sans">They owe you</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpeningBalanceForm({...openingBalanceForm, type: 'credit'})}
                      className={`py-3 px-4 rounded-xl border font-semibold text-xs md:text-sm text-center transition-all ${
                        openingBalanceForm.type === 'credit'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-600 shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Credit / Advance
                      <span className="block text-[10px] font-normal text-gray-400 mt-0.5 font-sans">They paid advance</span>
                    </button>
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-4">
                <Button type="submit" className="bg-[#5A5A40] hover:bg-[#4A4A30] w-full h-12 rounded-full text-lg mt-2">
                  Save Opening Balance
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Parties List sidebar */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="border-none shadow-sm bg-white rounded-[24px]">
            <CardHeader className="p-4 pb-2 border-b border-gray-50 flex flex-row items-center justify-between cursor-pointer lg:cursor-default" onClick={() => setIsPartiesMobileExpanded(!isPartiesMobileExpanded)}>
              <div className="flex flex-col">
                <CardTitle className="text-serif text-lg font-medium text-gray-800">Select Party</CardTitle>
                {selectedParty && (
                  <p className="text-[11px] text-[#5A5A40] font-sans font-semibold lg:hidden mt-0.5">
                    Selected: {selectedParty}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#5A5A40]" />
                <span className="lg:hidden text-[10px] uppercase font-bold text-gray-400 shrink-0">
                  {isPartiesMobileExpanded ? 'Hide ▴' : 'Show ▾'}
                </span>
              </div>
            </CardHeader>
            <CardContent className={`p-4 space-y-4 ${isPartiesMobileExpanded ? 'block' : 'hidden lg:block'}`}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input 
                  placeholder="Search party..." 
                  className="pl-9 text-xs rounded-full h-9 bg-gray-50/50 border-gray-200"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1 no-scrollbar">
                {filteredParties.map((party) => (
                  <button
                    key={party}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedParty(party);
                      setIsPartiesMobileExpanded(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all font-medium text-xs md:text-sm flex justify-between items-center ${
                      selectedParty === party
                        ? 'bg-[#5A5A40] text-white shadow-sm shadow-[#5A5A40]/10'
                        : 'bg-transparent text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate">{party}</span>
                    <ChevronRightBadge active={selectedParty === party} />
                  </button>
                ))}
                {filteredParties.length === 0 && (
                  <div className="py-8 text-center text-xs text-gray-400 italic">
                    No parties found
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Ledger Statement Details */}
        <div className="lg:col-span-3 space-y-6">
          {selectedParty ? (
            <div className="space-y-6">
              {/* Legacy Opening Balance Configuration Banner */}
              <div className="bg-amber-50/20 rounded-2xl p-4 border border-amber-200/45 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h4 className="font-serif text-sm font-semibold text-amber-900 flex items-center gap-2">
                    <BookOpen size={16} className="text-[#5A5A40]" />
                    <span>Legacy Opening Balance</span>
                  </h4>
                  <p className="text-[11px] text-gray-500 font-serif italic mt-0.5">
                    Opening balance for <strong className="text-[#5A5A40] font-sans">{selectedParty}</strong> prior to first transaction in this ledger.
                  </p>
                </div>
                <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                  <div className="text-left sm:text-right">
                    <p className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">Configured Balance</p>
                    <p className={`text-sm font-bold font-mono ${customOpeningAmount > 0 ? 'text-red-600' : customOpeningAmount < 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                      {customOpeningAmount > 0 ? `₹${customOpeningAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (Dr/Due)` : customOpeningAmount < 0 ? `₹${Math.abs(customOpeningAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (Cr/Adv)` : '₹0.00 (None)'}
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleOpenOpeningBalance}
                    className="border-amber-200 hover:bg-amber-100 text-amber-900 rounded-full text-xs font-serif shrink-0 h-9 px-3"
                  >
                    Set Balance
                  </Button>
                </div>
              </div>

              {/* Ledger Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="border border-red-100 bg-red-50/20 shadow-none rounded-[20px] p-5">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-red-500 font-bold mb-1">
                        {startDate || endDate ? 'Period Billed' : 'Total Billed'}
                      </p>
                      <h3 className="text-2xl font-mono font-bold text-gray-800">₹{totalBilled.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                    </div>
                    <ArrowUpCircle className="h-6 w-6 text-red-500" />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 font-serif italic">
                    {startDate || endDate ? `Billed from ${startDate || 'start'} to ${endDate || 'present'}` : 'Aggregate job sheet & plate charges'}
                  </p>
                </Card>

                <Card className="border border-emerald-100 bg-emerald-50/20 shadow-none rounded-[20px] p-5">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-emerald-600 font-bold mb-1">
                        {startDate || endDate ? 'Period Received' : 'Total Received'}
                      </p>
                      <h3 className="text-2xl font-mono font-bold text-gray-800">₹{totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                    </div>
                    <ArrowDownCircle className="h-6 w-6 text-emerald-500" />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 font-serif italic">
                    {startDate || endDate ? `Payments received in this period` : 'Sum of recorded credit payments'}
                  </p>
                </Card>

                <Card className={`border rounded-[20px] p-5 shadow-none ${
                  balanceOverall > 0 
                    ? 'border-orange-200 bg-orange-50/10' 
                    : balanceOverall < 0 
                    ? 'border-blue-200 bg-blue-50/10' 
                    : 'border-gray-200 bg-gray-50/20'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Total Outstanding</p>
                      <h3 className={`text-2xl font-mono font-bold ${balanceOverall > 0 ? 'text-orange-600' : balanceOverall < 0 ? 'text-blue-600' : 'text-gray-800'}`}>
                        ₹{Math.abs(balanceOverall).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </h3>
                    </div>
                    <IndianRupee className={`h-6 w-6 ${balanceOverall > 0 ? 'text-orange-500' : balanceOverall < 0 ? 'text-blue-500' : 'text-gray-400'}`} />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 font-serif italic">
                    {balanceOverall > 0 ? 'Debit amount due from client' : balanceOverall < 0 ? 'Excess payment credit' : 'All accounts settled'}
                  </p>
                </Card>
              </div>

              {/* Date Filter & Export Tool Bar */}
              <Card className="border-none shadow-sm bg-white rounded-[20px] p-4 md:p-5">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-end gap-4 flex-1 max-w-2xl">
                    <div className="grid grid-cols-2 gap-3 flex-1">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-gray-400 font-bold font-serif">From Date</label>
                        <Input 
                          type="date" 
                          value={startDate} 
                          onChange={e => setStartDate(e.target.value)}
                          className="rounded-xl border-gray-150 h-10 text-xs text-gray-600 bg-gray-50/30 font-sans"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-gray-400 font-bold font-serif">To Date</label>
                        <Input 
                          type="date" 
                          value={endDate} 
                          onChange={e => setEndDate(e.target.value)}
                          className="rounded-xl border-gray-150 h-10 text-xs text-gray-600 bg-gray-50/30 font-sans"
                        />
                      </div>
                    </div>
                    {/* Toggle option for details */}
                    <div className="flex items-center gap-2 pb-1.5 select-none shrink-0">
                      <input
                        type="checkbox"
                        id="toggle-detailed-ledger"
                        checked={showDetailedLedger}
                        onChange={(e) => {
                          setShowDetailedLedger(e.target.checked);
                          localStorage.setItem('pdf_show_detailed_ledger', e.target.checked ? 'true' : 'false');
                        }}
                        className="rounded border-gray-300 text-[#5A5A40] focus:ring-[#5A5A40] h-4 w-4 cursor-pointer accent-[#5A5A40]"
                      />
                      <label htmlFor="toggle-detailed-ledger" className="text-xs text-gray-600 font-medium cursor-pointer font-sans">
                        Show Job Details
                      </label>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    {(startDate || endDate) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setStartDate(''); setEndDate(''); }}
                        className="text-gray-400 hover:text-gray-650 text-xs h-10 rounded-full"
                      >
                        Reset Dates
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadCSV}
                      className="border-gray-200 hover:bg-gray-50 rounded-full h-10 text-xs flex items-center gap-1.5 px-4 font-serif text-gray-700"
                    >
                      <ArrowDownCircle size={14} className="text-[#5A5A40]" />
                      <span>Download CSV</span>
                    </Button>
                    <Button
                      onClick={handlePrintPDF}
                      className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white rounded-full h-10 text-xs flex items-center gap-1.5 px-4 font-serif"
                    >
                      <FileText size={14} />
                      <span>Print PDF Statement</span>
                    </Button>
                  </div>
                </div>

              </Card>

              {/* Transactions Ledger Table */}
              <Card className="border-none shadow-sm bg-white rounded-[24px] overflow-hidden">
                <CardHeader className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/50 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="font-serif text-lg font-medium text-gray-800">Ledger Statement</CardTitle>
                    <p className="text-[11px] text-gray-400 font-serif italic">Statement of accounts for {selectedParty}</p>
                  </div>
                  <div className="text-[10px] uppercase tracking-widest bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full font-bold">
                    Statement
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {/* Desktop Statement - Full Grid */}
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent border-gray-100">
                          <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider pl-4 md:pl-6">Date</TableHead>
                          <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider">Type</TableHead>
                          <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider">Particulars / Details</TableHead>
                          <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right">Debit (+)</TableHead>
                          <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right border-r border-gray-100/30">Credit (-)</TableHead>
                          <TableHead className="font-serif italic text-gray-400 uppercase text-[10px] tracking-wider text-right pr-4 md:pr-6">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(startDate || openingBalance !== 0) && (
                          <TableRow className="bg-gray-50/50 border-gray-100/50 hover:bg-gray-50/80 transition-colors">
                            <TableCell className="pl-4 md:pl-6 text-xs text-gray-400 font-mono">
                              {startDate ? format(new Date(startDate + 'T00:00:00'), 'dd-MM-yy') : '—'}
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center text-[10px] font-bold bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 border border-gray-200/50">
                                OPENING
                              </span>
                            </TableCell>
                            <TableCell className="py-3 md:py-4">
                              <div className="flex flex-col">
                                <span className="text-gray-600 font-semibold text-xs md:text-sm italic">
                                  {startDate ? 'Balance Brought Forward (Opening)' : 'Opening Balance (Past Dues/Advance)'}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {startDate ? 'Account statement opening balance offset' : 'Pre-existing legacy balance before transactions'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs md:text-sm text-gray-400">-</TableCell>
                            <TableCell className="text-right font-mono text-xs md:text-sm text-gray-400 border-r border-gray-100/30">-</TableCell>
                            <TableCell className="text-right pr-4 md:pr-6">
                              <span className={`font-mono text-xs md:text-sm font-semibold ${openingBalance > 0 ? 'text-orange-600' : openingBalance < 0 ? 'text-blue-600' : 'text-gray-800'}`}>
                                ₹{openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </TableCell>
                          </TableRow>
                        )}
                        {transactions.map((tr) => (
                          <TableRow key={tr.id} className="group border-gray-100/50 hover:bg-gray-50/50 transition-colors">
                            <TableCell className="pl-4 md:pl-6 text-xs text-gray-500 font-mono">
                              {format(new Date(tr.date), 'dd-MM-yy')}
                            </TableCell>
                            <TableCell>
                              {tr.type === 'debit' ? (
                                <span className="inline-flex items-center text-[10px] font-semibold bg-red-50 text-red-600 rounded-full px-2 py-0.5 border border-red-100/50">
                                  JOB BILL
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-[10px] font-semibold bg-emerald-50 text-emerald-600 rounded-full px-2 py-0.5 border border-emerald-100/50">
                                  RECEIPT
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="py-3 md:py-4">
                              <div className="flex flex-col">
                                <span className="text-gray-800 font-semibold text-xs md:text-sm">{tr.title}</span>
                                {(showDetailedLedger || tr.type === 'credit') && tr.details && tr.details.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1.5 max-w-xl">
                                    {tr.details.map((detail, idx) => (
                                      <span key={idx} className="inline-flex items-center text-[10px] text-gray-500 bg-gray-50 border border-gray-200/50 rounded-md px-2 py-0.5 font-sans leading-tight">
                                        {detail}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs md:text-sm text-red-600">
                              {tr.type === 'debit' ? `₹${tr.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs md:text-sm text-emerald-600 border-r border-gray-100/30 relative">
                              <div className="flex items-center justify-end gap-2 pr-2">
                                {tr.type === 'credit' ? `₹${tr.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                                {tr.type === 'credit' && (
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => handleDeletePayment(tr.id)}
                                    className="h-6 w-6 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Delete payment receipt"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right pr-4 md:pr-6">
                              <span className={`font-mono text-xs md:text-sm font-semibold ${tr.balance > 0 ? 'text-orange-600' : tr.balance < 0 ? 'text-blue-600' : 'text-gray-800'}`}>
                                ₹{tr.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                        {transactions.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="h-32 text-center text-gray-400 font-serif italic">
                              No transactions on record for {selectedParty}.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile Statement - Custom Card-Based Ledger Log */}
                  <div className="md:hidden divide-y divide-gray-100">
                    {(startDate || openingBalance !== 0) && (
                      <div className="p-4 bg-gray-50/50 space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[10px] font-bold bg-gray-150 text-gray-500 rounded px-1.5 py-0.5 border border-gray-200">
                              OPENING
                            </span>
                            <h4 className="text-xs font-serif italic font-semibold text-gray-600 mt-2">
                              {startDate ? 'Balance Brought Forward' : 'Opening Balance (Past Dues/Advance)'}
                            </h4>
                          </div>
                          <span className="text-xs font-mono text-gray-400">
                            {startDate ? format(new Date(startDate + 'T00:00:00'), 'dd-MM-yy') : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-gray-150/40">
                          <span className="text-[10px] text-gray-400 uppercase tracking-widest">Opening Bal</span>
                          <span className={`font-mono text-sm font-semibold ${openingBalance > 0 ? 'text-orange-600' : openingBalance < 0 ? 'text-blue-600' : 'text-gray-800'}`}>
                            ₹{openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    )}

                    {transactions.map((tr) => (
                      <div key={tr.id} className="p-4 space-y-3 hover:bg-gray-50/20 transition-colors">
                        <div className="flex justify-between items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {tr.type === 'debit' ? (
                                <span className="text-[9px] font-bold bg-red-50 text-red-600 rounded px-1.5 py-0.5 border border-red-100">
                                  JOB BILL
                                </span>
                              ) : (
                                <span className="text-[9px] font-semibold bg-emerald-50 text-emerald-600 rounded px-1.5 py-0.5 border border-emerald-100">
                                  RECEIPT
                                </span>
                              )}
                              <span className="text-[10px] font-mono text-gray-400">
                                {format(new Date(tr.date), 'dd-MM-yy')}
                              </span>
                            </div>
                            <h4 className="text-sm font-semibold text-gray-800 mt-1.5 break-words leading-snug">{tr.title}</h4>
                            {(showDetailedLedger || tr.type === 'credit') && tr.details && tr.details.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {tr.details.map((detail, idx) => (
                                  <span key={idx} className="inline-flex items-center text-[9px] text-gray-500 bg-gray-50 border border-gray-200/50 rounded-md px-1.5 py-0.5 font-sans leading-tight">
                                    {detail}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          <div className="text-right shrink-0">
                            {tr.type === 'debit' ? (
                              <span className="font-mono text-sm font-bold text-red-600">
                                +₹{tr.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            ) : (
                              <div className="flex items-center gap-1">
                                {tr.type === 'credit' && (
                                  <Button 
                                    variant="outline" 
                                    size="icon" 
                                    onClick={() => handleDeletePayment(tr.id)}
                                    className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50 border-red-100 rounded-full shrink-0"
                                    title="Delete payment receipt"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                                <span className="font-mono text-sm font-bold text-emerald-600">
                                  -₹{tr.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Outst. Balance</span>
                          <span className={`font-mono text-xs font-semibold ${tr.balance > 0 ? 'text-orange-600' : tr.balance < 0 ? 'text-blue-600' : 'text-gray-800'}`}>
                            ₹{tr.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    ))}

                    {transactions.length === 0 && (
                      <div className="p-8 text-center text-gray-400 font-serif italic text-xs">
                        No transactions on record for {selectedParty}.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="py-24 text-center text-gray-400 font-serif italic border border-dashed rounded-[24px] bg-white">
              Create a job or record a payment to verify account statements.
            </div>
          )}
        </div>
      </div>

      {isClearConfirmOpen && (
        <Dialog open={isClearConfirmOpen} onOpenChange={(open) => {
          setIsClearConfirmOpen(open);
          if (!open) setDeleteConfirmText('');
        }}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Clear Payments History</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <p className="text-gray-600 text-sm">
                Are you sure you want to permanently clear all recorded payment receipts? This will delete <span className="font-bold text-gray-900">all credits and payments</span> from all ledger books. This action is irreversible.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-red-600 uppercase tracking-wider block">
                  To confirm, type "DELETE ALL PAYMENTS" below:
                </label>
                <Input
                  className="rounded-xl border-gray-200"
                  placeholder="DELETE ALL PAYMENTS"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  disabled={isClearing}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => {
                setIsClearConfirmOpen(false);
                setDeleteConfirmText('');
              }} className="rounded-full" disabled={isClearing}>Cancel</Button>
              <Button 
                variant="destructive" 
                onClick={() => {
                  handleClearPayments();
                  setDeleteConfirmText('');
                }} 
                className="rounded-full px-8 font-serif" 
                disabled={isClearing || deleteConfirmText !== 'DELETE ALL PAYMENTS'}
              >
                {isClearing ? 'Clearing...' : 'Clear Payment History'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ChevronRightBadge({ active }: { active: boolean }) {
  return (
    <div className={`p-1 rounded-full ${active ? 'bg-white/20 text-white' : 'text-gray-300'}`}>
      <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
        <path d="M8.59,16.59L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.59Z" />
      </svg>
    </div>
  );
}
