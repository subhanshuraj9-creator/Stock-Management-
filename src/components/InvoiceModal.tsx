import React, { useState } from 'react';
import { Job, StockItem } from '../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Printer, Download, FileText, Check, Settings, Eye, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: Job | null;
  stocks: StockItem[];
  jobs?: Job[];
}

export const ACCENT_COLORS = {
  original: {
    primary: '#5A5A40',
    light: '#FAF9F5',
    text: '#5A5A40',
    border: '#E9E9DB',
    hover: '#4A4A30'
  },
  blue: {
    primary: '#1E3A8A',
    light: '#F0F4FC',
    text: '#1E3A8A',
    border: '#DCE6F7',
    hover: '#172E6B'
  },
  green: {
    primary: '#065F46',
    light: '#ECFDF5',
    text: '#065F46',
    border: '#D1FAE5',
    hover: '#044E39'
  },
  crimson: {
    primary: '#991B1B',
    light: '#FEF2F2',
    text: '#991B1B',
    border: '#FEE2E2',
    hover: '#7F1313'
  },
  charcoal: {
    primary: '#374151',
    light: '#F3F4F6',
    text: '#374151',
    border: '#E5E7EB',
    hover: '#1F2937'
  }
};

export const LAYOUT_THEMES = {
  classic: {
    name: 'Classic Georgia / Royal',
    fontFamily: '"Georgia", serif',
    bodyFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    titleClass: 'font-serif tracking-tight',
  },
  modern: {
    name: 'Modern Sans / Corporate',
    fontFamily: '"Inter", sans-serif',
    bodyFont: '"Inter", sans-serif',
    titleClass: 'font-sans font-bold tracking-tight',
  },
  elegant: {
    name: 'Elegant Playfair / Minimal',
    fontFamily: '"Playfair Display", serif',
    bodyFont: '"Inter", sans-serif',
    titleClass: 'font-serif tracking-wide italic',
  },
  compact: {
    name: 'Compact Mono / Technical',
    fontFamily: '"JetBrains Mono", monospace',
    bodyFont: '"JetBrains Mono", monospace',
    titleClass: 'font-mono tracking-wider font-extrabold',
  }
};

export function InvoiceModal({ isOpen, onClose, job, stocks, jobs = [] }: InvoiceModalProps) {
  const [pressDetails, setPressDetails] = useState(() => {
    const saved = localStorage.getItem('press_details');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback to default
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

  const [showConfig, setShowConfig] = useState(false);
  const [zoom, setZoom] = useState<number>(0.85);
  const [profileExpanded, setProfileExpanded] = useState<boolean>(false);

  // User print/layout customization preferences
  const [layoutTheme, setLayoutTheme] = useState<'classic' | 'modern' | 'elegant' | 'compact'>(() => {
    return (localStorage.getItem('pdf_layout_theme') as any) || 'classic';
  });
  const [accentColor, setAccentColor] = useState<'original' | 'blue' | 'green' | 'crimson' | 'charcoal'>(() => {
    return (localStorage.getItem('pdf_accent_color') as any) || 'original';
  });
  const [headerMode, setHeaderMode] = useState<'full_header' | 'letterhead'>(() => {
    return (localStorage.getItem('pdf_header_mode') as any) || 'full_header';
  });
  const [showSignature, setShowSignature] = useState<boolean>(() => {
    return localStorage.getItem('pdf_show_signature') !== 'false';
  });
  const [showTerms, setShowTerms] = useState<boolean>(() => {
    return localStorage.getItem('pdf_show_terms') !== 'false';
  });

  // Keep localStorage in sync when fields change
  React.useEffect(() => {
    localStorage.setItem('press_details', JSON.stringify(pressDetails));
  }, [pressDetails]);

  // Synchronize from localStorage whenever dialog opens in case edited elsewhere
  React.useEffect(() => {
    if (isOpen) {
      setShowConfig(false);
      const savedTheme = localStorage.getItem('pdf_layout_theme');
      if (savedTheme) setLayoutTheme(savedTheme as any);
      
      const savedColor = localStorage.getItem('pdf_accent_color');
      if (savedColor) setAccentColor(savedColor as any);
      
      const savedHeader = localStorage.getItem('pdf_header_mode');
      if (savedHeader) setHeaderMode(savedHeader as any);
      
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
    }
  }, [isOpen]);

  const updateLayoutSetting = (key: string, value: string) => {
    localStorage.setItem(key, value);
    if (key === 'pdf_layout_theme') setLayoutTheme(value as any);
    if (key === 'pdf_accent_color') setAccentColor(value as any);
    if (key === 'pdf_header_mode') setHeaderMode(value as any);
    if (key === 'pdf_show_signature') setShowSignature(value === 'true');
    if (key === 'pdf_show_terms') setShowTerms(value === 'true');
  };

  // Resolve plates used (including joint job plates lookup)
  const resolvedPlates = React.useMemo(() => {
    if (!job) return [];
    const list = [...(job.platesUsed || [])];
    if (job.isJoint && job.jointRef && jobs && jobs.length > 0) {
      const cleanRef = job.jointRef.trim().toUpperCase().replace('#', '');
      const referencedJob = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
      if (referencedJob && referencedJob.platesUsed) {
        referencedJob.platesUsed.filter(p => !p.isCancelled).forEach(refPlate => {
          const isDuplicate = list.some(p => p.plateId === refPlate.plateId);
          if (!isDuplicate) {
            list.push({
              ...refPlate,
              isJointRef: true,
              refJobId: referencedJob.id
            } as any);
          }
        });
      }
    }
    return list;
  }, [job, jobs]);

  if (!job) return null;

  // Calculate totals
  const papersTotal = job.items.reduce((sum, item) => {
    const hasAutoCalculated = (item.ups !== undefined && item.ups > 0 && job.orderedQuantity && job.orderedQuantity > 0);
    const billingSheets = hasAutoCalculated 
      ? Math.ceil(job.orderedQuantity / (item.ups || 1)) 
      : (item.calculatedSheets !== undefined ? item.calculatedSheets : (item.isJoint ? 0 : item.quantityUsed));
    return sum + (((billingSheets || 0) / 500) * (item.rate || 0));
  }, 0);
  const platesTotal = resolvedPlates.reduce((sum, plate) => sum + ((plate.count || 0) * (plate.rate || 0)), 0);
  const processesTotal = (job.processCharges || []).reduce((sum, pc) => sum + (pc.amount || 0), 0);
  
  const halfLaminationTotal = job.lamination?.halfEnabled
    ? (job.lamination.halfQty || 0) * (job.lamination.halfRate || 0)
    : 0;
  const fullLaminationTotal = job.lamination?.fullEnabled
    ? (job.lamination.fullQty || 0) * (job.lamination.fullRate || 0)
    : 0;
  const laminationTotal = halfLaminationTotal + fullLaminationTotal;

  const grandTotal = papersTotal + platesTotal + processesTotal + laminationTotal;

  const activeColor = ACCENT_COLORS[accentColor] || ACCENT_COLORS.original;
  const activeTheme = LAYOUT_THEMES[layoutTheme] || LAYOUT_THEMES.classic;

  // Trigger browser printing
  const handlePrint = () => {
    // We create a temporary print container in the main document, style it beautifully, and run print.
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Popup blocked. Please allow popups to print/save the invoice.');
      return;
    }

    const activeColor = ACCENT_COLORS[accentColor] || ACCENT_COLORS.original;
    const activeTheme = LAYOUT_THEMES[layoutTheme] || LAYOUT_THEMES.classic;

    const paperRows = job.items.map(item => {
      const stock = stocks.find(s => s.id === item.stockId);
      const hasAutoCalculated = (item.ups !== undefined && item.ups > 0 && job.orderedQuantity && job.orderedQuantity > 0);
      const billingSheets = hasAutoCalculated 
        ? Math.ceil(job.orderedQuantity / (item.ups || 1)) 
        : (item.calculatedSheets !== undefined ? item.calculatedSheets : (item.isJoint ? 0 : item.quantityUsed));
      const total = ((billingSheets || 0) / 500) * (item.rate || 0);
      return `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid var(--border-color); font-size: 13px;">
            <div style="font-weight: 600; color: #1a202c;">${stock?.name || 'Stock Material'}</div>
          </td>
          <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-family: monospace;">
            ${billingSheets}
            ${hasAutoCalculated ? ` <div style="color:#718096; font-size: 9px; margin-top: 2px;">(Calculated of ${job.orderedQuantity || 0} qty / ${item.ups || 1} ups)</div>` : ''}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-family: monospace;">₹${(item.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} <span style="font-size: 10px; color: #718096;">/500 shs</span></td>
          <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-weight: bold; font-family: monospace;">₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    }).join('');

    const plateRows = resolvedPlates.map(plate => {
      const stock = stocks.find(s => s.id === plate.plateId);
      const total = (plate.count || 0) * (plate.rate || 0);
      const isAdditional = (job.isJoint || (job.jointRef && job.jointRef.trim() !== '')) && !plate.isJoint && !plate.isJointRef;
      const displayName = isAdditional ? `${stock?.name || 'Printing Plate'} (Additional Plate)` : (stock?.name || 'Printing Plate');
      return `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid var(--border-color); font-size: 13px;">
            ${displayName}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-family: monospace;">${plate.count}</td>
          <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-family: monospace;">₹${(plate.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-weight: bold; font-family: monospace;">₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    }).join('');

    const processRows = (job.processCharges || []).filter(pc => pc.amount > 0).map(pc => {
      return `
        <tr>
          <td colspan="3" style="padding: 10px; border-bottom: 1px solid var(--border-color); font-size: 13px;">
            ${pc.name}
            ${pc.notes ? `<span style="font-size: 11px; color: #666; font-style: italic; margin-left: 8px;">(${pc.notes})</span>` : ''}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-weight: bold; font-family: monospace;">₹${pc.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    }).join('');

    let printLaminationRows = '';
    const lam = job.lamination;
    if (lam) {
      const rows: string[] = [];
      if (lam.halfEnabled) {
        const halfTotal = (lam.halfQty || 0) * (lam.halfRate || 0);
        rows.push(`
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid var(--border-color); font-size: 13px;">
              Half Lamination
            </td>
            <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-family: monospace;">${(lam.halfQty || 0).toLocaleString()}</td>
            <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-family: monospace;">₹${(lam.halfRate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-weight: bold; font-family: monospace;">₹${halfTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          </tr>
        `);
      }
      if (lam.fullEnabled) {
        const fullTotal = (lam.fullQty || 0) * (lam.fullRate || 0);
        rows.push(`
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid var(--border-color); font-size: 13px;">
              Full Lamination
            </td>
            <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-family: monospace;">${(lam.fullQty || 0).toLocaleString()}</td>
            <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-family: monospace;">₹${(lam.fullRate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td style="padding: 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-size: 13px; font-weight: bold; font-family: monospace;">₹${fullTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          </tr>
        `);
      }
      printLaminationRows = rows.join('');
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice - ${job.clientName}</title>
        <meta charset="utf-8" />
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
            line-height: 1.4;
            padding: 40px;
          }
          .invoice-container {
            max-width: 800px;
            margin: 0 auto;
            border: 1px solid var(--border-color);
            padding: 40px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.02);
            background: #fff;
            border-radius: ${layoutTheme === 'modern' ? '16px' : '0px'};
          }
          .header {
            border-bottom: ${headerMode === 'letterhead' ? 'none' : '2px solid var(--primary)'};
            padding-bottom: 20px;
            margin-bottom: 30px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .header h1 {
            font-size: 24px;
            margin: 0 0 5px 0;
            color: var(--primary);
            font-family: var(--font-display);
            font-weight: 700;
          }
          .press-info {
            font-size: 12px;
            color: #555;
          }
          .invoice-titling {
            text-align: right;
          }
          .invoice-titling h2 {
            font-size: 28px;
            font-weight: 600;
            margin: 0 0 10px 0;
            color: var(--primary);
            font-family: var(--font-display);
            letter-spacing: 1.5px;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 40px;
          }
          .meta-block {
            font-size: 13px;
          }
          .meta-title {
            font-weight: bold;
            text-transform: uppercase;
            font-size: 10px;
            color: #888;
            letter-spacing: 1px;
            margin-bottom: 5px;
          }
          .client-name {
            font-size: 16px;
            font-weight: bold;
            color: #111;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
          }
          th {
            background-color: var(--primary);
            color: white;
            padding: 8px 10px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            text-align: left;
          }
          .section-title-row td {
            background-color: var(--light-bg);
            font-weight: bold;
            font-size: 12px;
            color: var(--primary);
            padding: 8px 10px;
            border-bottom: 1px solid var(--border-color);
          }
          .totals-table {
            width: 300px;
            margin-left: auto;
            margin-bottom: 40px;
          }
          .totals-table td {
            padding: 8px 10px;
            font-size: 13px;
          }
          .grand-total-row {
            background-color: var(--primary);
            color: white;
            font-weight: bold;
          }
          .grand-total-row td {
            font-size: 16px !important;
            color: white !important;
          }
          .footer {
            margin-top: 65px;
            border-top: 1px solid var(--border-color);
            padding-top: 20px;
            font-size: 11.5px;
            color: #666;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          @media print {
            body {
              padding: 0;
            }
            .invoice-container {
              border: none;
              box-shadow: none;
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          ${headerMode === 'letterhead' ? `
            <div style="height: 165px; display: flex; align-items: flex-end; justify-content: flex-end; margin-bottom: 30px; border-bottom: 1px dashed var(--border-color);" class="letterhead-marked">
              <span style="font-size: 10px; color:#a0aec0; margin-bottom: 4px; font-family: monospace;">PRE-PRINTED LETTERHEAD SPACE</span>
            </div>
          ` : ''}

          <div class="header">
            ${headerMode === 'full_header' ? `
              <div>
                <h1>${pressDetails.name}</h1>
                <div class="press-info">
                  <div>${pressDetails.address}</div>
                  <div>Phone: ${pressDetails.phone}</div>
                  <div>Email: ${pressDetails.email}</div>
                  ${pressDetails.gstNumber ? `<div>GSTIN: ${pressDetails.gstNumber}</div>` : ''}
                </div>
              </div>
            ` : `<div>&nbsp;</div>`}
            
            <div class="invoice-titling" style="${headerMode === 'letterhead' ? 'margin-top: -10px;' : ''}">
              <h2>INVOICE</h2>
              <div style="font-size: 13px;">
                <strong>Invoice No:</strong> ${pressDetails.invoicePrefix}${job.id.slice(-6).toUpperCase()}<br/>
                <strong>Date:</strong> ${format(job.date, 'dd MMM yyyy')}<br/>
                <strong>Time:</strong> ${format(job.date, 'hh:mm a')}
              </div>
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-block">
              <div class="meta-title">Billed To (Party)</div>
              <div class="client-name">${job.clientName}</div>
              <div style="color:#555; margin-top:4px;">Print Job Settlement Statement</div>
            </div>
            <div class="meta-block">
              <div class="meta-title">Job Particulars</div>
              <div style="font-size:14px; font-weight:600; color:#333;">${job.jobDescription}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="text-align: left;">Particulars</th>
                <th style="text-align: right; width: 100px;">Qty / Count</th>
                <th style="text-align: right; width: 120px;">Rate (₹)</th>
                <th style="text-align: right; width: 140px;">Total (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${paperRows.length > 0 ? `
                <tr class="section-title-row">
                  <td colspan="4">MATERIAL & PAPER COST</td>
                </tr>
                ${paperRows}
              ` : ''}

              ${plateRows.length > 0 ? `
                <tr class="section-title-row">
                  <td colspan="4">PLATE MAKER & PRE-PRESS CHARGES</td>
                </tr>
                ${plateRows}
              ` : ''}

              ${processRows.length > 0 ? `
                <tr class="section-title-row">
                  <td colspan="4">PROCESS & FINISHING CHARGES</td>
                </tr>
                ${processRows}
              ` : ''}

              ${printLaminationRows ? `
                <tr class="section-title-row">
                  <td colspan="4">LAMINATION SERVICES</td>
                </tr>
                ${printLaminationRows}
              ` : ''}
            </tbody>
          </table>

          <table class="totals-table">
            <tr>
              <td>Paper Total:</td>
              <td style="text-align: right; font-family: monospace;">₹${papersTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td>Plates Total:</td>
              <td style="text-align: right; font-family: monospace;">₹${platesTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td>Processes Total:</td>
              <td style="text-align: right; font-family: monospace;">₹${processesTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            ${laminationTotal > 0 ? `
            <tr>
              <td>Lamination Total:</td>
              <td style="text-align: right; font-family: monospace;">₹${laminationTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            <tr class="grand-total-row">
              <td>Grand Total:</td>
              <td style="text-align: right; font-family: monospace; color: white;">₹${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </table>

          <div style="margin-top:30px; font-size:12px; color: #555; font-style: italic;">
            <strong>Amount in words:</strong> Rupee ${NumberToWords(grandTotal)} Only
          </div>

          <div class="footer">
            ${showTerms ? `
              <div style="max-width: 60%; line-height: 1.5;">
                <strong>Terms & Conditions:</strong><br/>
                1. This is a computer-generated statement of the designated job order.<br/>
                2. Subject to realization of matching client ledger balance.
              </div>
            ` : `<div>&nbsp;</div>`}

            ${showSignature ? `
              <div style="border-top: 1px solid var(--primary); width: 200px; text-align: center; padding-top: 8px;">
                For <strong>${pressDetails.name}</strong><br/><br/><br/>
                Authorized Signatory
              </div>
            ` : ''}
          </div>
        </div>
        <script>
          window.onload = function() {
            window.print();
          }
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // Build the dynamic download trigger for a styled, reusable HTML file
  const handleDownloadInvoice = () => {
    const activeColor = ACCENT_COLORS[accentColor] || ACCENT_COLORS.original;
    const activeTheme = LAYOUT_THEMES[layoutTheme] || LAYOUT_THEMES.classic;

    const paperRows = job.items.map(item => {
      const stock = stocks.find(s => s.id === item.stockId);
      const hasAutoCalculated = (item.ups !== undefined && item.ups > 0 && job.orderedQuantity && job.orderedQuantity > 0);
      const billingSheets = hasAutoCalculated 
        ? Math.ceil(job.orderedQuantity / (item.ups || 1)) 
        : (item.calculatedSheets !== undefined ? item.calculatedSheets : (item.isJoint ? 0 : item.quantityUsed));
      const total = ((billingSheets || 0) / 500) * (item.rate || 0);
      return `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; font-size: 13.5px;">
            <div style="font-weight: 600; color: #2d3748;">${stock?.name || 'Stock Material'}</div>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-family: Menlo, Monaco, monospace; color:#4a5568;">
            ${billingSheets}
            ${hasAutoCalculated ? ` <span style="color:#718096; font-size: 10px;">(Calculated of ${job.orderedQuantity || 0} qty / ${item.ups || 1} ups)</span>` : ''}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-family: Menlo, Monaco, monospace; color:#4a5568;">₹${(item.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} <span style="font-size: 9.5px; color:#718096;">/500 shs</span></td>
          <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-weight: bold; font-family: Menlo, Monaco, monospace; color:#1a202c;">₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    }).join('');

    const plateRows = resolvedPlates.map(plate => {
      const stock = stocks.find(s => s.id === plate.plateId);
      const total = (plate.count || 0) * (plate.rate || 0);
      const isAdditional = (job.isJoint || (job.jointRef && job.jointRef.trim() !== '')) && !plate.isJoint && !plate.isJointRef;
      const displayName = isAdditional ? `${stock?.name || 'Printing Plate'} (Additional Plate)` : (stock?.name || 'Printing Plate');
      return `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; font-size: 13.5px; color:#2d3748;">
            ${displayName}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-family: Menlo, Monaco, monospace; color:#4a5568;">${plate.count}</td>
          <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-family: Menlo, Monaco, monospace; color:#4a5568;">₹${(plate.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-weight: bold; font-family: Menlo, Monaco, monospace; color:#1a202c;">₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    }).join('');

    const processRows = (job.processCharges || []).filter(pc => pc.amount > 0).map(pc => {
      return `
        <tr>
          <td colspan="3" style="padding: 12px; border-bottom: 1px solid #f1f1f1; font-size: 13.5px; color:#2d3748;">
            ${pc.name}
            ${pc.notes ? `<span style="font-size: 11px; color:#718096; font-style: italic; margin-left: 10px;">(${pc.notes})</span>` : ''}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-weight: bold; font-family: Menlo, Monaco, monospace; color:#1a202c;">₹${pc.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    }).join('');

    let downloadLaminationRows = '';
    const lamInfo = job.lamination;
    if (lamInfo) {
      const rows: string[] = [];
      if (lamInfo.halfEnabled) {
        const halfTotal = (lamInfo.halfQty || 0) * (lamInfo.halfRate || 0);
        rows.push(`
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; font-size: 13.5px; color:#2d3748;">
              Half Lamination
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-family: Menlo, Monaco, monospace; color:#4a5568;">${(lamInfo.halfQty || 0).toLocaleString()}</td>
            <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-family: Menlo, Monaco, monospace; color:#4a5568;">₹${(lamInfo.halfRate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-weight: bold; font-family: Menlo, Monaco, monospace; color:#1a202c;">₹${halfTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          </tr>
        `);
      }
      if (lamInfo.fullEnabled) {
        const fullTotal = (lamInfo.fullQty || 0) * (lamInfo.fullRate || 0);
        rows.push(`
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; font-size: 13.5px; color:#2d3748;">
              Full Lamination
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-family: Menlo, Monaco, monospace; color:#4a5568;">${(lamInfo.fullQty || 0).toLocaleString()}</td>
            <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-family: Menlo, Monaco, monospace; color:#4a5568;">₹${(lamInfo.fullRate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td style="padding: 12px; border-bottom: 1px solid #f1f1f1; text-align: right; font-size: 13.5px; font-weight: bold; font-family: Menlo, Monaco, monospace; color:#1a202c;">₹${fullTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          </tr>
        `);
      }
      downloadLaminationRows = rows.join('');
    }

    const dlHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice - ${job.clientName}</title>
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
            background: #f7f9fa;
            color: #2d3748;
            padding: 40px 20px;
            margin: 0;
          }
          .card {
            background: #ffffff;
            max-width: 850px;
            margin: 0 auto;
            border-radius: ${layoutTheme === 'modern' ? '24px' : '0px'};
            border: 1px solid var(--border-color);
            box-shadow: 0 10px 25px rgba(0,0,0,0.03);
            overflow: hidden;
          }
          .deco-bar {
            height: 6px;
            background: var(--primary);
          }
          .pad-wrapper {
            padding: 50px;
          }
          .header-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: ${headerMode === 'letterhead' ? 'none' : '1px solid var(--border-color)'};
            padding-bottom: 30px;
            margin-bottom: 35px;
          }
          .brand-name {
            font-family: var(--font-display);
            font-weight: 700;
            font-size: 26px;
            color: var(--primary);
            margin: 0 0 8px 0;
            letter-spacing: -0.3px;
          }
          .brand-info {
            font-size: 12.5px;
            color: #4a5568;
            line-height: 1.5;
          }
          .inv-title-container {
            text-align: right;
          }
          .inv-heavy {
            font-family: var(--font-display);
            font-size: 32px;
            font-weight: 700;
            letter-spacing: 2px;
            color: var(--primary);
            margin: 0 0 12px 0;
          }
          .inv-details {
            font-size: 13px;
            color: #4a5568;
            line-height: 1.6;
          }
          .party-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
            margin-bottom: 40px;
          }
          .block-label {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: #a0aec0;
            margin-bottom: 8px;
          }
          .party-name {
            font-size: 16px;
            font-weight: 700;
            color: #2d3748;
          }
          .job-desc {
            font-family: var(--font-display);
            font-size: 16px;
            font-style: italic;
            color: var(--primary);
            margin-top: 4px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 35px;
          }
          th {
            background-color: var(--primary);
            color: #ffffff;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1.2px;
            padding: 12px;
            border-bottom: 2px solid var(--border-color);
            text-align: left;
          }
          .sec-header td {
            background-color: var(--light-bg);
            font-weight: 600;
            font-size: 12px;
            color: var(--primary);
            padding: 12px;
            border-bottom: 1px solid var(--border-color);
          }
          .summary-table {
            width: 320px;
            margin-left: auto;
            margin-bottom: 40px;
          }
          .summary-table td {
            padding: 8px 12px;
            font-size: 13.5px;
            color: #4a5568;
          }
          .total-row {
            background-color: var(--primary);
            color: #ffffff !important;
            font-weight: 700;
          }
          .total-row td {
            color: #ffffff !important;
            font-size: 16px;
            padding: 12px !important;
          }
          .terms {
            margin-top: 50px;
            padding-top: 25px;
            border-top: 1px solid var(--border-color);
            font-size: 11.5px;
            color: #718096;
            line-height: 1.6;
          }
          .sign-area {
            display: flex;
            justify-content: space-between;
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
          .action-panel {
            background: #ffffff;
            border-radius: 12px;
            border: 1px solid #e1e8ed;
            padding: 15px 25px;
            max-width: 850px;
            margin: 0 auto 20px auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .action-btn {
            background-color: #5a5a40;
            color: #ffffff;
            border: none;
            padding: 10px 20px;
            border-radius: 9999px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
            text-decoration: none;
          }
          .action-btn:hover {
            background-color: #4a4a30;
          }
          @media print {
            body {
              background: #fff;
              padding: 0;
            }
            .card {
              border: none;
              box-shadow: none;
            }
            .pad-wrapper {
              padding: 20px;
            }
            .action-panel {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="action-panel">
          <span style="font-size: 13.5px; color:#4a5568; font-weight:500;">Invoice Reference Statement compiled successfully</span>
          <button class="action-btn" onclick="window.print()">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
            Print or Save as PDF
          </button>
        </div>

        <div class="card">
          <div class="deco-bar"></div>
          <div class="pad-wrapper">
            <div class="header-row">
              <div>
                <h1 class="brand-name">${pressDetails.name}</h1>
                <div class="brand-info">
                  <div>${pressDetails.address}</div>
                  <div>Phone: ${pressDetails.phone} &bull; Email: ${pressDetails.email}</div>
                  ${pressDetails.gstNumber ? `<div style="margin-top:2px;">GSTIN: <strong>${pressDetails.gstNumber}</strong></div>` : ''}
                </div>
              </div>
              <div class="inv-title-container">
                <h2 class="inv-heavy">INVOICE</h2>
                <div class="inv-details">
                  Invoice No: <strong>${pressDetails.invoicePrefix}${job.id.slice(-6).toUpperCase()}</strong><br>
                  Date: <strong>${format(job.date, 'dd MMM yyyy')}</strong><br>
                  Settlement Method: Ledger Statement
                </div>
              </div>
            </div>

            <div class="party-grid">
              <div>
                <div class="block-label">Billed To (Party Accounts)</div>
                <div class="party-name">${job.clientName}</div>
                <div style="font-size: 12.5px; color: #718096; margin-top:3px;">Account Ledger reconciliation registered.</div>
              </div>
              <div>
                <div class="block-label">Print Job Item Particulars</div>
                <div style="font-size: 15px; font-weight: 600; color:#2d3748;">${job.jobDescription}</div>
                <div class="job-desc">Press Job ID #${job.id.slice(-4).toUpperCase()}</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Job Elements & Work Summary</th>
                  <th style="text-align: right; width: 110px;">Quantity</th>
                  <th style="text-align: right; width: 130px;">Rate Charge</th>
                  <th style="text-align: right; width: 140px;">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                ${paperRows.length > 0 ? `
                  <tr class="sec-header">
                    <td colspan="4">I. PAPER & CARD STOCKS ESTIMATES</td>
                  </tr>
                  ${paperRows}
                ` : ''}

                ${plateRows.length > 0 ? `
                  <tr class="sec-header">
                    <td colspan="4">II. PRE-PRESS & METAL PLATES CHARGES</td>
                  </tr>
                  ${plateRows}
                ` : ''}

                ${processRows.length > 0 ? `
                  <tr class="sec-header">
                    <td colspan="4">III. PRESS OPERATIONS & PROCESS-WISE CHARGES</td>
                  </tr>
                  ${processRows}
                ` : ''}

                ${downloadLaminationRows ? `
                  <tr class="sec-header">
                    <td colspan="4">IV. LAMINATION CHARGES & SERVICES</td>
                  </tr>
                  ${downloadLaminationRows}
                ` : ''}
              </tbody>
            </table>

            <table class="summary-table">
              <tr>
                <td>Paper cost total:</td>
                <td style="text-align: right; font-family: Menlo, Monaco, monospace;">₹${papersTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td>Plates cost total:</td>
                <td style="text-align: right; font-family: Menlo, Monaco, monospace;">₹${platesTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td>Process charges total:</td>
                <td style="text-align: right; font-family: Menlo, Monaco, monospace;">₹${processesTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
              ${laminationTotal > 0 ? `
              <tr>
                <td>Lamination total:</td>
                <td style="text-align: right; font-family: Menlo, Monaco, monospace;">₹${laminationTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
              ` : ''}
              <tr class="total-row">
                <td style="font-weight: bold; border-radius: 6px 0 0 6px;">GRAND TOTAL BALANCE:</td>
                <td style="text-align: right; font-family: Menlo, Monaco, monospace; font-weight: bold; border-radius: 0 6px 6px 0;">₹${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            </table>

            <div style="font-size: 13px; color:#4a5568; margin-bottom: 30px;">
              <strong>Billed Amount in words:</strong> Rupee ${NumberToWords(grandTotal)} Only
            </div>

            <div class="sign-area">
              <div class="terms">
                <strong>Statement Explanatory Notes:</strong><br>
                &bull; Complete settlement has been debited against the party's ledger automatically.<br>
                &bull; In case of physical copies adjustments or folding faults, report within 2 business days.
              </div>
              <div class="stamp-signature">
                For <strong>${pressDetails.name}</strong><br><br><br>
                Authorized Signatory
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const blob = new Blob([dlHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Invoice-${job.clientName.replace(/\s+/g, '_')}-${format(job.date, 'yyyyMMdd')}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Invoice HTML downloaded successfully!');
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto rounded-[24px] md:rounded-[32px] p-0 border-none gap-0">
        
        <DialogHeader className="p-6 pb-4 bg-gray-50 border-b border-gray-100">
          <div className="flex justify-between items-center pr-6">
            <div>
              <DialogTitle className="font-serif text-2xl font-semibold flex items-center gap-2 text-gray-900">
                <FileText className="h-5 w-5 text-[#5A5A40]" /> Job Invoice Statement
              </DialogTitle>
              <p className="text-xs text-gray-500 font-serif italic mt-0.5">Prepare, customize letterhead and print/download client invoice</p>
            </div>
            <Button 
              size="sm" 
              type="button"
              variant="outline" 
              onClick={() => setShowConfig(!showConfig)} 
              className={`rounded-full gap-1.5 h-8 text-xs font-semibold ${showConfig ? 'bg-[#5A5A40] text-white hover:bg-[#4A4A30]' : 'text-[#5A5A40]'}`}
            >
              <Settings className="h-3.5 w-3.5" /> {showConfig ? 'Hide Settings' : 'Business Settings'}
            </Button>
          </div>
        </DialogHeader>

        {showConfig && (
          <div className="p-5 bg-amber-50/50 border-b border-amber-100 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Press / Business Name</Label>
              <Input 
                value={pressDetails.name} 
                onChange={e => setPressDetails({...pressDetails, name: e.target.value.toUpperCase()})}
                className="bg-white h-9 text-xs"
                id="press-input-name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Phone Contacts</Label>
              <Input 
                value={pressDetails.phone} 
                onChange={e => setPressDetails({...pressDetails, phone: e.target.value})}
                className="bg-white h-9 text-xs"
                id="press-input-phone"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Press Address</Label>
              <Input 
                value={pressDetails.address} 
                onChange={e => setPressDetails({...pressDetails, address: e.target.value})}
                className="bg-white h-9 text-xs"
                id="press-input-address"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Email Address</Label>
              <Input 
                value={pressDetails.email} 
                onChange={e => setPressDetails({...pressDetails, email: e.target.value})}
                className="bg-white h-9 text-xs"
                id="press-input-email"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">GSTIN Number</Label>
              <Input 
                value={pressDetails.gstNumber} 
                onChange={e => setPressDetails({...pressDetails, gstNumber: e.target.value})}
                className="bg-white h-9 text-xs"
                id="press-input-gst"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Invoice No. Prefix</Label>
              <Input 
                value={pressDetails.invoicePrefix} 
                onChange={e => setPressDetails({...pressDetails, invoicePrefix: e.target.value})}
                className="bg-white h-9 text-xs"
                id="press-input-prefix"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Invoice Style Layout</Label>
              <select
                value={layoutTheme}
                onChange={e => updateLayoutSetting('pdf_layout_theme', e.target.value)}
                className="w-full bg-white h-9 text-xs rounded-lg border border-gray-200 px-2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
              >
                <option value="classic">Classic Georgia / Royal</option>
                <option value="modern">Modern Sans / Corporate</option>
                <option value="elegant">Elegant Playfair / Minimal</option>
                <option value="compact">Compact Mono / Technical</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Accent Theme Color</Label>
              <select
                value={accentColor}
                onChange={e => updateLayoutSetting('pdf_accent_color', e.target.value)}
                className="w-full bg-white h-9 text-xs rounded-lg border border-gray-200 px-2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
              >
                <option value="original">Original Olive / Khaki</option>
                <option value="blue">Deep Corporate Blue</option>
                <option value="green">Emerald Green</option>
                <option value="crimson">Crimson Red</option>
                <option value="charcoal">Slate Charcoal</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Header Mode / Blank Space</Label>
              <select
                value={headerMode}
                onChange={e => updateLayoutSetting('pdf_header_mode', e.target.value)}
                className="w-full bg-white h-9 text-xs rounded-lg border border-gray-200 px-2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
              >
                <option value="full_header">Print Full Business Header</option>
                <option value="letterhead">Blank (Use Preprinted Letterhead)</option>
              </select>
            </div>
            <div className="md:col-span-2 border-t border-amber-100 pt-4 mt-2">
              <div className="flex flex-wrap gap-6 items-center bg-white/70 p-2.5 rounded-lg border border-amber-100/50">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-900 mr-2">Toggle Footer Sections:</Label>
                
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={showTerms} 
                    onChange={e => updateLayoutSetting('pdf_show_terms', e.target.checked ? 'true' : 'false')}
                    className="rounded border-gray-300 text-[#5A5A40] focus:ring-[#5A5A40]" 
                  />
                  Statement Explanatory Notes & Terms
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={showSignature} 
                    onChange={e => updateLayoutSetting('pdf_show_signature', e.target.checked ? 'true' : 'false')}
                    className="rounded border-gray-300 text-[#5A5A40] focus:ring-[#5A5A40]" 
                  />
                  Authorized Signatory Seal Slot
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Beautiful visual preview paper element */}
        <div className="p-3 sm:p-6 bg-gray-50/30 flex justify-center">
          <div className="w-full max-w-[620px] bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 md:p-8 space-y-6 shadow-sm relative overflow-hidden" style={{ fontFamily: activeTheme.bodyFont }}>
            {/* Elegant side ribbon */}
            <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: activeColor.primary }} />
            
            {/* Letterhead */}
            {headerMode === 'letterhead' ? (
              <div style={{ borderColor: activeColor.border }} className="h-32 border-2 border-dashed rounded-xl flex items-center justify-center bg-gray-50/50">
                <span className="text-[10px] uppercase font-mono tracking-widest text-gray-400">Preprinted Letterhead Space (No Print Header)</span>
              </div>
            ) : (
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-4 border-gray-100">
                <div>
                  <h4 style={{ color: activeColor.primary, fontFamily: activeTheme.fontFamily }} className="text-lg font-bold tracking-tight uppercase">{pressDetails.name}</h4>
                  <p className="text-[10px] text-gray-500 max-w-[300px] mt-0.5">{pressDetails.address}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Ph: {pressDetails.phone} | Email: {pressDetails.email}</p>
                  {pressDetails.gstNumber && <p className="text-[10px] font-bold text-gray-700 mt-0.5">GSTIN: {pressDetails.gstNumber}</p>}
                </div>
                <div className="text-right">
                  <span style={{ backgroundColor: activeColor.light, color: activeColor.primary }} className="text-xs uppercase font-extrabold tracking-widest px-2 py-0.5 rounded">Statement</span>
                  <p className="font-mono text-[10px] text-gray-500 mt-1">
                    Inv #: <span className="font-semibold">{pressDetails.invoicePrefix}{job.id.slice(-6).toUpperCase()}</span><br />
                    Date: {format(job.date, 'dd MMM yyyy')}
                  </p>
                </div>
              </div>
            )}

            {/* Billed To / Job Metadata */}
            <div className="grid grid-cols-2 gap-4 text-xs font-serif">
              <div>
                <span className="text-[9px] uppercase tracking-wider text-gray-400 block font-sans font-bold">Client / Party:</span>
                <span className="font-bold text-gray-950 text-sm block mt-0.5">{job.clientName}</span>
                <p className="text-[10px] text-gray-400 mt-0.5">Account Balance reconciled</p>
              </div>
              <div>
                <span className="text-[9px] uppercase tracking-wider text-gray-400 block font-sans font-bold">Job Particulars:</span>
                <span className="font-semibold text-gray-800 italic block mt-0.5">"{job.jobDescription}"</span>
                <p className="font-mono text-[9px] text-gray-400 mt-0.5">JobID: {job.id.slice(-4).toUpperCase()}</p>
              </div>
            </div>

            {/* Bills breakdown Accordion / Table */}
            <div className="space-y-4">
              <h5 style={{ color: activeColor.primary }} className="text-[10px] uppercase tracking-widest font-sans font-extrabold border-b pb-1">Billed Items breakdown</h5>
              
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {job.items.map((item, idx) => {
                  const stock = stocks.find(s => s.id === item.stockId);
                  const hasAutoCalculated = (item.ups !== undefined && item.ups > 0 && job.orderedQuantity && job.orderedQuantity > 0);
                  const billingSheets = hasAutoCalculated 
                    ? Math.ceil(job.orderedQuantity / (item.ups || 1)) 
                    : (item.calculatedSheets !== undefined ? item.calculatedSheets : (item.isJoint ? 0 : item.quantityUsed));
                  const total = ((billingSheets || 0) / 500) * (item.rate || 0);
                  return (
                    <div key={`p-idx-${idx}`} className="flex justify-between items-start text-xs font-sans py-1 hover:bg-gray-50 rounded px-1">
                      <div>
                        <span className="font-semibold text-gray-900 flex flex-wrap items-center gap-1.5 leading-tight">
                          {stock?.name || 'Stock Material'}
                        </span>
                        <div className="text-[10px] text-gray-400">
                          {billingSheets} sheets{' '}
                          {hasAutoCalculated ? (
                            <span className="text-amber-700 font-semibold">(calculated of {job.orderedQuantity || 0} qty / {item.ups || 1} ups)</span>
                          ) : (
                            <span>(actual)</span>
                          )}
                          {' '}@ ₹{(item.rate || 0).toFixed(2)}/500 shs
                        </div>
                      </div>
                      <span className="font-mono font-semibold text-gray-900">₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  );
                })}

                {/* Plates used */}
                {resolvedPlates.map((plate, idx) => {
                  const stock = stocks.find(s => s.id === plate.plateId);
                  const total = (plate.count || 0) * (plate.rate || 0);
                  const isAdditional = (job.isJoint || (job.jointRef && job.jointRef.trim() !== '')) && !plate.isJoint && !plate.isJointRef;
                  return (
                    <div key={`pl-idx-${idx}`} className="flex justify-between items-start text-xs font-sans py-1 hover:bg-gray-50 rounded px-1">
                      <div>
                        <span className="font-medium text-gray-800 flex flex-wrap items-center gap-1.5">
                          {stock?.name || 'Printing Plate'} 
                          {isAdditional && (
                            <span className="text-[9px] font-bold bg-pink-100 text-pink-800 px-1.5 rounded-full uppercase leading-relaxed shrink-0">
                              Additional Plate
                            </span>
                          )}
                          {plate.isJointRef && (
                            <span className="text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200/50 px-1 rounded uppercase leading-relaxed shrink-0">
                              Joint Plate
                            </span>
                          )}
                        </span>
                        <div className="text-[10px] text-gray-400">
                          {plate.count} plate{plate.count > 1 ? 's' : ''} @ ₹{(plate.rate || 0).toFixed(2)}
                        </div>
                      </div>
                      <span className="font-mono font-semibold text-gray-900">₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  );
                })}

                {/* Process wise charges */}
                {(job.processCharges || []).filter(pc => pc.amount > 0).map((pc, idx) => (
                  <div key={`pc-idx-${idx}`} className="flex justify-between items-start text-xs font-sans py-1 hover:bg-gray-50 rounded px-1">
                    <div>
                      <span className="font-medium text-gray-800">{pc.name}</span>
                      {pc.notes && <div className="text-[10px] text-gray-400 italic">({pc.notes})</div>}
                    </div>
                    <span className="font-mono font-semibold text-gray-900">₹{pc.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}

                {/* Lamination services */}
                {job.lamination?.halfEnabled && (
                  <div className="flex justify-between items-start text-xs font-sans py-1 hover:bg-gray-50 rounded px-1 border-t border-dashed mt-1 pt-1">
                    <div>
                      <span className="font-medium text-gray-850">Half Lamination</span>
                      <div className="text-[10px] text-gray-400">
                        {job.lamination.halfQty || 0} sheets @ ₹{(job.lamination.halfRate || 0).toFixed(2)}/sh
                      </div>
                    </div>
                    <span className="font-mono font-semibold text-gray-900">₹{((job.lamination.halfQty || 0) * (job.lamination.halfRate || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {job.lamination?.fullEnabled && (
                  <div className="flex justify-between items-start text-xs font-sans py-1 hover:bg-gray-50 rounded px-1 border-t border-dashed mt-1 pt-1">
                    <div>
                      <span className="font-medium text-gray-850">Full Lamination</span>
                      <div className="text-[10px] text-gray-400">
                        {job.lamination.fullQty || 0} sheets @ ₹{(job.lamination.fullRate || 0).toFixed(2)}/sh
                      </div>
                    </div>
                    <span className="font-mono font-semibold text-gray-900">₹{((job.lamination.fullQty || 0) * (job.lamination.fullRate || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Calculations breakdown block */}
            <div className="border-t pt-4 flex flex-col items-end space-y-1.5 text-xs text-gray-600">
              <div className="flex justify-between w-[220px]">
                <span>Paper Materials cost:</span>
                <span className="font-mono font-medium">₹{papersTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between w-[220px]">
                <span>Plates pre-press total:</span>
                <span className="font-mono font-medium">₹{platesTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between w-[220px]">
                <span>Operations process charges:</span>
                <span className="font-mono font-medium">₹{processesTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              {laminationTotal > 0 && (
                <div className="flex justify-between w-[220px]">
                  <span>Lamination total:</span>
                  <span className="font-mono font-medium">₹{laminationTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="flex justify-between w-[220px] pt-2 border-t font-semibold text-gray-950 bg-gray-50 p-2 rounded-xl">
                <span>Grand Total Billed:</span>
                <span className="font-mono text-sm font-bold" style={{ color: activeColor.primary }}>₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Amount in words footer line */}
            <div className="text-[10px] text-gray-500 font-serif italic border-t pt-3">
              <strong>Grand Total (in words):</strong> Rupee {NumberToWords(grandTotal)} Only
            </div>

            {/* Conditional footer terms & signatory */}
            {(showTerms || showSignature) && (
              <div className="flex justify-between items-end border-t pt-4 mt-6 text-[10px] text-gray-500">
                {showTerms ? (
                  <div className="max-w-[60%]">
                    <strong>Notes:</strong>
                    <ol className="list-decimal pl-4 mt-1 space-y-0.5 text-[9px] text-gray-400">
                      <li>This represents a chronological statement of designated job order.</li>
                      <li>Adjustments are subject to realisations of party accounts.</li>
                    </ol>
                  </div>
                ) : <div />}
                {showSignature ? (
                  <div className="w-32 text-center pt-1 text-[9px] font-bold text-gray-400 shrink-0 border-t border-dashed">
                    For {pressDetails.name}
                  </div>
                ) : <div />}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col md:flex-row gap-3">
          <Button 
            type="button" 
            variant="ghost" 
            onClick={onClose} 
            className="rounded-full w-full md:w-auto h-11"
          >
            Close Statement
          </Button>
          <div className="flex-1 flex gap-2 w-full">
            <Button 
              type="button" 
              onClick={handlePrint} 
              variant="outline"
              className="rounded-full gap-2 border-[#5A5A40] text-[#5A5A40] hover:bg-gray-100 h-11 flex-1 font-semibold"
            >
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            <Button 
              type="button" 
              onClick={handleDownloadInvoice} 
              className="rounded-full bg-[#5A5A40] hover:bg-[#4A4A30] text-white gap-2 h-11 flex-1 font-semibold"
            >
              <Download className="h-4 w-4" /> Download Statement
            </Button>
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

// Simple Indian Rupee naming converter for text-to-finance representations
function NumberToWords(num: number): string {
  const rounded = Math.round(num); // Simple rounding for ledger representing words
  if (rounded === 0) return 'Zero';

  const singleDigits = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teenDigits = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const doubleDigits = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convertLessThanThousand = (n: number): string => {
    let output = '';
    if (n >= 100) {
      output += singleDigits[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 10 && n < 20) {
      output += teenDigits[n - 10] + ' ';
    } else if (n >= 20) {
      output += doubleDigits[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0 && n < 10) {
      output += singleDigits[n] + ' ';
    }
    return output;
  };

  let nStr = rounded.toString();
  let result = '';

  let numeric = rounded;
  
  if (numeric >= 10000000) { // Crore
    const cr = Math.floor(numeric / 10000000);
    result += convertLessThanThousand(cr) + 'Crore ';
    numeric %= 10000000;
  }
  if (numeric >= 100000) { // Lakh
    const lk = Math.floor(numeric / 100000);
    result += convertLessThanThousand(lk) + 'Lakh ';
    numeric %= 100000;
  }
  if (numeric >= 1000) { // Thousand
    const th = Math.floor(numeric / 1000);
    result += convertLessThanThousand(th) + 'Thousand ';
    numeric %= 1000;
  }
  if (numeric > 0) {
    result += convertLessThanThousand(numeric);
  }

  return result.trim().replace(/\s+/g, ' ');
}
