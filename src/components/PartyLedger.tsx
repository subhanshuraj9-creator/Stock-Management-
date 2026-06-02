import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, addDoc, query, orderBy, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { Job, StockItem, Payment } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Plus, Search, BookOpen, IndianRupee, ArrowDownCircle, ArrowUpCircle, Trash2, Calendar, FileText, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
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

export function PartyLedger() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedParty, setSelectedParty] = useState<string>('');
  const [isPartiesMobileExpanded, setIsPartiesMobileExpanded] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
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

    if (startDate) {
      csvContent += `"${format(new Date(startDate + 'T00:00:00'), 'dd MMM yyyy')}","OPENING","Balance Brought Forward (Opening)","-","-","INR ${openingBalance.toFixed(2)}"\n`;
    }

    const chronological = [...transactions].reverse();
    chronological.forEach(t => {
      const dateStr = format(new Date(t.date), 'dd MMM yyyy');
      const typeStr = t.type === 'debit' ? 'JOB BILL' : 'RECEIPT';
      const titleEscaped = t.title.replace(/"/g, '""');
      const detailsJoin = (t.details || []).join(' | ').replace(/"/g, '""');
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
      ? `Period: ${startDate ? format(new Date(startDate + 'T00:00:00'), 'dd MMM yyyy') : 'Beginning'} to ${endDate ? format(new Date(endDate + 'T23:59:59'), 'dd MMM yyyy') : 'Present'}`
      : 'Full Ledger Accounts';

    const itemsRows = [...transactions].reverse().map(tr => `
      <tr style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 12px 14px; font-family: monospace; font-size: 11px; color: #4a5568;">
          ${format(new Date(tr.date), 'dd MMM yyyy')}
        </td>
        <td style="padding: 12px 14px; font-size: 11px; font-weight: 600;">
          <span style="display: inline-block; padding: 2px 7px; border-radius: 4px; ${
            tr.type === 'debit' 
              ? 'background-color: #fee2e2; color: #991b1b; border: 1px solid rgba(153,27,27,0.1);' 
              : 'background-color: #d1fae5; color: #065f46; border: 1px solid rgba(6,95,70,0.1);'
          }">
            ${tr.type === 'debit' ? 'JOB BILL' : 'RECEIPT'}
          </span>
        </td>
        <td style="padding: 12px 14px; font-size: 12px; color: #1a202c;">
          <div style="font-weight: 600; color: #2d3748;">${tr.title}</div>
          ${tr.details && tr.details.length > 0 
            ? `<div style="font-size: 10px; color: #718096; margin-top: 5px; line-height: 1.4;">
                ${tr.details.map((d: string) => `• ${d}`).join('<br/>')}
               </div>` 
            : ''
          }
        </td>
        <td style="padding: 12px 14px; text-align: right; font-family: monospace; font-size: 12px; color: #e53e3e; font-weight: 500;">
          ${tr.type === 'debit' ? `₹${tr.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
        </td>
        <td style="padding: 12px 14px; text-align: right; font-family: monospace; font-size: 12px; color: #38a169; font-weight: 500;">
          ${tr.type === 'credit' ? `₹${tr.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
        </td>
        <td style="padding: 12px 14px; text-align: right; font-family: monospace; font-size: 12px; font-weight: 600; color: ${tr.balance > 0 ? '#dd6b20' : tr.balance < 0 ? '#3182ce' : '#2d3748'};">
          ₹${tr.balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
      </tr>
    `).join('');

    const openingBalanceRow = startDate ? `
      <tr style="border-bottom: 1px solid var(--border-color); background-color: var(--light-bg);">
        <td style="padding: 12px 14px; font-family: monospace; font-size: 11px; color: #718096;">
          ${format(new Date(startDate + 'T00:00:00'), 'dd MMM yyyy')}
        </td>
        <td style="padding: 12px 14px; font-size: 11px; font-weight: bold; color: #4a5568;">
          OPENING
        </td>
        <td style="padding: 12px 14px; font-size: 12px; font-weight: bold; color: #4a5568; font-style: italic;">
          Balance Brought Forward (Opening)
        </td>
        <td style="padding: 12px 14px; text-align: right;">-</td>
        <td style="padding: 12px 14px; text-align: right;">-</td>
        <td style="padding: 12px 14px; text-align: right; font-family: monospace; font-size: 12px; font-weight: bold; color: ${openingBalance > 0 ? '#dd6b20' : openingBalance < 0 ? '#3182ce' : '#4a5568'};">
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
              padding: 40px;
              margin: 0;
            }
            .header {
              border-bottom: ${headerMode === 'letterhead' ? 'none' : '2px solid var(--primary)'};
              padding-bottom: 20px;
              margin-bottom: 25px;
            }
            .company-name {
              font-family: var(--font-display);
              font-size: 24px;
              font-weight: 700;
              color: var(--primary);
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .title {
              font-family: var(--font-display);
              font-size: 26px;
              font-weight: 600;
              margin-top: 5px;
              color: #1a202c;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 20px;
              margin-bottom: 30px;
              font-size: 13px;
            }
            .meta-block p {
              margin: 4px 0;
            }
            .summary-cards {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr;
              gap: 15px;
              margin-bottom: 30px;
            }
            .card {
              border: 1px solid var(--border-color);
              border-radius: ${layoutTheme === 'modern' ? '16px' : '0px'};
              padding: 16px;
            }
            .card-title {
              font-size: 11px;
              color: #718096;
              text-transform: uppercase;
              font-weight: bold;
              margin: 0 0 6px 0;
              letter-spacing: 0.5px;
            }
            .card-amount {
              font-size: 20px;
              font-weight: 700;
              margin: 0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 30px;
            }
            th {
              background-color: var(--light-bg);
              color: var(--primary);
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              text-align: left;
              padding: 12px 14px;
              border-bottom: 2px solid var(--border-color);
            }
            .footer {
              text-align: center;
              font-size: 11px;
              color: #a0aec0;
              margin-top: 50px;
              border-top: 1px solid var(--border-color);
              padding-top: 20px;
            }
            .sign-section {
              display: flex;
              justify-content: ${showTerms ? 'space-between' : 'flex-end'};
              align-items: flex-end;
              margin-top: 40px;
            }
            .stamp-signature {
              border-top: 1px solid var(--primary);
              width: 220px;
              text-align: center;
              padding-top: 10px;
              font-size: 13px;
              font-weight: 500;
              color: #4a5568;
            }
            @media print {
              body { padding: 0; }
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
            <div style="height: 165px; display: flex; align-items: flex-end; justify-content: flex-end; margin-bottom: 30px; border-bottom: 1px dashed var(--border-color);">
              <span style="font-size: 10px; color:#a0aec0; margin-bottom: 4px; font-family: monospace;">PRE-PRINTED LETTERHEAD SPACE</span>
            </div>
          ` : ''}

          <div class="header">
            <div style="display: flex; justify-content: space-between; align-items: flex-end;">
              ${headerMode === 'full_header' ? `
                <div>
                  <div class="company-name">${pressDetails.name}</div>
                  <div style="font-size: 11px; color: #718096; margin-top: 4px; line-height: 1.4; text-align: left;">
                    ${pressDetails.address}<br/>
                    Ph: ${pressDetails.phone} | Email: ${pressDetails.email}
                    ${pressDetails.gstNumber ? `<br/><strong>GSTIN:</strong> ${pressDetails.gstNumber}` : ''}
                  </div>
                  <div class="title" style="margin-top: 15px;">Ledger Account Statement</div>
                </div>
              ` : `<div><div class="title">Ledger Account Statement</div></div>`}
              <div style="text-align: right; font-size: 12px; color: #718096; ${headerMode === 'letterhead' ? 'margin-top: -10px;' : ''}">
                Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}
              </div>
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-block">
              <p style="font-weight: bold; font-size: 14px; color: #4a5568; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Party/Client Details:</p>
              <p style="font-size: 18px; font-weight: bold; color: #1a202c; margin: 0;">${selectedParty}</p>
              <p style="color: #718096; margin-top: 4px; font-size: 12px;">Active printing ledger accounts book</p>
            </div>
            <div class="meta-block" style="text-align: right; display: flex; flex-direction: column; justify-content: flex-end;">
              <p style="font-weight: 600; color: #4a5568; margin: 0;">Statement Period Range:</p>
              <p style="font-size: 14px; font-weight: bold; color: #2d3748; margin: 4px 0 0 0;">${dateRangeStr}</p>
            </div>
          </div>

          <div class="summary-cards">
            <div class="card" style="border-left: 4px solid #f56565; background-color: #fff5f5;">
              <h4 class="card-title" style="color: #c53030;">Debits added in period</h4>
              <p class="card-amount" style="color: #c53030;">₹${totalBilled.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div class="card" style="border-left: 4px solid #48bb78; background-color: #f0fff4;">
              <h4 class="card-title" style="color: #22543d;">Credits paid in period</h4>
              <p class="card-amount" style="color: #22543d;">₹${totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div class="card" style="border-left: 4px solid var(--primary); background-color: var(--light-bg);">
              <h4 class="card-title" style="color: var(--primary);">Closing Period Outstanding</h4>
              <p class="card-amount" style="color: var(--primary);">₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 130px;">Date</th>
                <th style="width: 110px;">Voucher</th>
                <th>Particulars / Description Of Transaction</th>
                <th style="width: 120px; text-align: right;">Debit (₹)</th>
                <th style="width: 120px; text-align: right;">Credit (₹)</th>
                <th style="width: 130px; text-align: right;">Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${openingBalanceRow}
              ${itemsRows}
            </tbody>
          </table>

          <div style="display: flex; justify-content: flex-end; margin-top: 15px;">
            <div style="width: 340px; border-top: 2px solid #2d3748; padding-top: 14px; font-size: 13px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-weight: 500; color: #4a5568;">Opening Balance Brought Forward:</span>
                <span style="font-family: monospace;">₹${openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: #c53030;">
                <span style="font-weight: 500;">(+) Total New Job Bills:</span>
                <span style="font-family: monospace;">₹${totalBilled.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: #22543d;">
                <span style="font-weight: 500;">(-) Total Received Credits:</span>
                <span style="font-family: monospace;">₹${totalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 10px; font-size: 15px; font-weight: bold; color: #1a202c;">
                <span>CLOSING BALANCE DUE:</span>
                <span style="font-family: monospace; color: var(--primary);">₹${balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div class="sign-section">
            ${showTerms ? `
              <div style="max-width: 60%; font-size: 11px; color:#718096; line-height: 1.5; text-align: left;">
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

    const paymentsQ = query(collection(db, 'payments'), orderBy('date', 'desc'));
    const unsubscribePayments = onSnapshot(paymentsQ, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment));
      setPayments(items);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'payments');
    });

    return () => {
      unsubscribeJobs();
      unsubscribeStocks();
      unsubscribePayments();
    };
  }, []);

  // Gather unique parties
  const uniqueParties = Array.from(new Set([
    ...jobs.map(j => j.clientName.trim()),
    ...payments.map(p => p.clientName.trim())
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

  // Compile ledger for selected party
  const getLedgerStatement = (partyName: string, startStr: string, endStr: string) => {
    if (!partyName) return { transactions: [], totalBilled: 0, totalPaid: 0, balance: 0, openingBalance: 0, totalBilledOverall: 0, totalPaidOverall: 0, balanceOverall: 0 };

    const partyJobs = jobs.filter(j => j.clientName.trim().toLowerCase() === partyName.trim().toLowerCase());
    const partyPayments = payments.filter(p => p.clientName.trim().toLowerCase() === partyName.trim().toLowerCase());

    const allTransactions: any[] = [];

    // Process job debit
    partyJobs.forEach(job => {
      let paperTotal = 0;
      const paperDetails: string[] = [];
      job.items.forEach(item => {
        const hasAutoCalculated = (item.ups !== undefined && item.ups > 0 && job.orderedQuantity && job.orderedQuantity > 0);
        const billingSheets = hasAutoCalculated 
          ? Math.ceil(job.orderedQuantity / (item.ups || 1)) 
          : (item.calculatedSheets !== undefined ? item.calculatedSheets : (item.isJoint ? 0 : item.quantityUsed));
        const itemCost = ((billingSheets || 0) / 500) * (item.rate || 0);
        paperTotal += itemCost;
        if (itemCost > 0) {
          const stock = stocks.find(s => s.id === item.stockId);
          paperDetails.push(`${stock?.name || 'Paper'}: ${billingSheets} sheets @ ₹${(item.rate || 0).toFixed(2)}/500 shs`);
        }
      });

      let plateTotal = 0;
      const plateDetails: string[] = [];
      const platesToProcess = [...(job.platesUsed || [])].filter(p => !p.isCancelled);

      if (job.isJoint && job.jointRef) {
        const cleanRef = job.jointRef.trim().toUpperCase().replace('#', '');
        const referencedJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
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
          const label = isAdditional ? `${stock?.name || 'Plate'} (Additional Plate)` : (stock?.name || 'Plate');
          plateDetails.push(`${label}: ${plate.count} @ ₹${(plate.rate || 0).toFixed(2)}`);
        }
      });

      let processTotal = 0;
      const processDetails: string[] = [];
      (job.processCharges || []).forEach(pc => {
        if (pc.amount > 0) {
          processTotal += pc.amount;
          processDetails.push(`${pc.name}: ₹${pc.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${pc.notes ? ` (${pc.notes})` : ''}`);
        }
      });

      let laminationTotal = 0;
      const laminationDetails: string[] = [];
      if (job.lamination?.halfEnabled) {
        const halfTotal = (job.lamination.halfQty || 0) * (job.lamination.halfRate || 0);
        if (halfTotal > 0) {
          laminationTotal += halfTotal;
          laminationDetails.push(`Half Lamination: ${job.lamination.halfQty?.toLocaleString()} sheets @ ₹${(job.lamination.halfRate || 0).toFixed(2)}/sh`);
        }
      }
      if (job.lamination?.fullEnabled) {
        const fullTotal = (job.lamination.fullQty || 0) * (job.lamination.fullRate || 0);
        if (fullTotal > 0) {
          laminationTotal += fullTotal;
          laminationDetails.push(`Full Lamination: ${job.lamination.fullQty?.toLocaleString()} sheets @ ₹${(job.lamination.fullRate || 0).toFixed(2)}/sh`);
        }
      }

      const totalDebit = paperTotal + plateTotal + processTotal + laminationTotal;

      allTransactions.push({
        id: job.id,
        date: job.date,
        type: 'debit',
        title: job.jobDescription,
        details: [...paperDetails, ...plateDetails, ...processDetails, ...laminationDetails],
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

    let openingBalance = 0;
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
    let balanceOverall = 0;
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
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
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
                  <div className="grid grid-cols-2 gap-3 flex-1 max-w-lg">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-gray-400 font-bold font-serif">From Date</label>
                      <Input 
                        type="date" 
                        value={startDate} 
                        onChange={e => setStartDate(e.target.value)}
                        className="rounded-xl border-gray-150 h-10 text-xs text-gray-600 bg-gray-50/30"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-gray-400 font-bold font-serif">To Date</label>
                      <Input 
                        type="date" 
                        value={endDate} 
                        onChange={e => setEndDate(e.target.value)}
                        className="rounded-xl border-gray-150 h-10 text-xs text-gray-600 bg-gray-50/30"
                      />
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
                      onClick={() => setShowConfig(!showConfig)}
                      variant="outline"
                      className={`border-[#5A5A40] text-[#5A5A40] hover:bg-amber-50/30 rounded-full h-10 text-xs flex items-center gap-1.5 px-4 font-serif ${showConfig ? 'bg-amber-50/50' : ''}`}
                    >
                      <Settings className="h-3.5 w-3.5" />
                      <span>Format PDF</span>
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

                {showConfig && (
                  <div className="p-5 bg-amber-50/20 border-t border-gray-100 rounded-b-[20px] grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Press / Business Name</Label>
                      <Input 
                        value={pressDetails.name} 
                        onChange={e => setPressDetails({...pressDetails, name: e.target.value.toUpperCase()})}
                        className="bg-white h-9 text-xs border-gray-200"
                        id="ledger-press-name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Phone Contacts</Label>
                      <Input 
                        value={pressDetails.phone} 
                        onChange={e => setPressDetails({...pressDetails, phone: e.target.value})}
                        className="bg-white h-9 text-xs border-gray-200"
                        id="ledger-press-phone"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Press Address</Label>
                      <Input 
                        value={pressDetails.address} 
                        onChange={e => setPressDetails({...pressDetails, address: e.target.value})}
                        className="bg-white h-9 text-xs border-gray-200"
                        id="ledger-press-address"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Email Address</Label>
                      <Input 
                        value={pressDetails.email} 
                        onChange={e => setPressDetails({...pressDetails, email: e.target.value})}
                        className="bg-white h-9 text-xs border-gray-200"
                        id="ledger-press-email"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">GSTIN Number</Label>
                      <Input 
                        value={pressDetails.gstNumber} 
                        onChange={e => setPressDetails({...pressDetails, gstNumber: e.target.value})}
                        className="bg-white h-9 text-xs border-gray-200"
                        id="ledger-press-gst"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Invoice No. Prefix</Label>
                      <Input 
                        value={pressDetails.invoicePrefix} 
                        onChange={e => setPressDetails({...pressDetails, invoicePrefix: e.target.value})}
                        className="bg-white h-9 text-xs border-gray-200"
                        id="ledger-press-prefix"
                      />
                    </div>
                    <div className="md:col-span-2 border-t border-amber-100 pt-4 mt-2">
                      <div className="flex flex-wrap gap-6 items-center bg-white p-2.5 rounded-lg border border-amber-100/50">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900 mr-2 font-sans">Toggle Footer Sections:</Label>
                        
                        <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={showTerms} 
                            onChange={e => updateLedgerSetting('showTerms', e.target.checked)}
                            className="rounded border-gray-300 text-[#5A5A40] focus:ring-[#5A5A40]" 
                          />
                          Statement Notes & Terms
                        </label>

                        <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={showSignature} 
                            onChange={e => updateLedgerSetting('showSignature', e.target.checked)}
                            className="rounded border-gray-300 text-[#5A5A40] focus:ring-[#5A5A40]" 
                          />
                          Authorized Signatory Slot
                        </label>
                      </div>
                    </div>
                  </div>
                )}
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
                        {startDate && (
                          <TableRow className="bg-gray-50/50 border-gray-100/50 hover:bg-gray-50/80 transition-colors">
                            <TableCell className="pl-4 md:pl-6 text-xs text-gray-400 font-mono">
                              {format(new Date(startDate + 'T00:00:00'), 'dd MMM yyyy')}
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center text-[10px] font-bold bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 border border-gray-200/50">
                                OPENING
                              </span>
                            </TableCell>
                            <TableCell className="py-3 md:py-4">
                              <div className="flex flex-col">
                                <span className="text-gray-600 font-semibold text-xs md:text-sm italic">Balance Brought Forward (Opening)</span>
                                <span className="text-[10px] text-gray-400">Account statement opening balance offset</span>
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
                              {format(new Date(tr.date), 'dd MMM yyyy')}
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
                                <span className="text-gray-800 font-medium text-xs md:text-sm">{tr.title}</span>
                                {tr.details && tr.details.length > 0 && (
                                  <div className="text-[10px] text-gray-400 mt-1 space-y-0.5">
                                    {tr.details.map((d: string, di: number) => (
                                      <div key={di}>• {d}</div>
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
                    {startDate && (
                      <div className="p-4 bg-gray-50/50 space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[10px] font-bold bg-gray-150 text-gray-500 rounded px-1.5 py-0.5 border border-gray-200">
                              OPENING
                            </span>
                            <h4 className="text-xs font-serif italic font-semibold text-gray-600 mt-2">
                              Balance Brought Forward
                            </h4>
                          </div>
                          <span className="text-xs font-mono text-gray-400">
                            {format(new Date(startDate + 'T00:00:00'), 'dd MMM yyyy')}
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
                                {format(new Date(tr.date), 'dd MMM yyyy')}
                              </span>
                            </div>
                            <h4 className="text-sm font-semibold text-gray-800 mt-1.5 break-words leading-snug">{tr.title}</h4>
                            {tr.details && tr.details.length > 0 && (
                              <div className="text-[11px] text-gray-400 mt-1 space-y-0.5 pl-1.5 border-l border-gray-100">
                                {tr.details.map((d: string, di: number) => (
                                  <div key={di} className="truncate">✓ {d}</div>
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
        <Dialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
          <DialogContent className="sm:max-w-[425px] rounded-[32px]">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Clear Payments History</DialogTitle>
            </DialogHeader>
            <div className="py-6">
              <p className="text-gray-600">
                Are you sure you want to permanently clear all recorded payment receipts? This will delete <span className="font-bold text-gray-900">all credits and payments</span> from all ledger books. This action is irreversible.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setIsClearConfirmOpen(false)} className="rounded-full" disabled={isClearing}>Cancel</Button>
              <Button variant="destructive" onClick={handleClearPayments} className="rounded-full px-8 font-serif" disabled={isClearing}>
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
