import React, { useState, useRef, useEffect } from 'react';
import { db } from '../firebase';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { Job, StockItem } from '../types';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Printer, Upload, X, Image as ImageIcon, Loader2, FileImage, ClipboardCheck, ArrowRight, TableProperties } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface JobPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: Job;
  stocks: StockItem[];
  jobs?: Job[];
}

export function JobPreviewModal({ isOpen, onClose, job: initialJob, stocks, jobs = [] }: JobPreviewModalProps) {
  const [job, setJob] = useState<Job>(initialJob);
  const [pressDetails] = useState(() => {
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

  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync real-time updates from Firestore for this job (so image uploads/changes are reflected)
  useEffect(() => {
    if (!initialJob?.id) return;
    
    // Set initial job
    setJob(initialJob);

    const unsubscribe = onSnapshot(doc(db, 'jobs', initialJob.id), (docSnap) => {
      if (docSnap.exists()) {
        const updatedJob = { id: docSnap.id, ...docSnap.data() } as Job;
        setJob(updatedJob);
      }
    }, (err) => {
      console.error('Error fetching real-time job update', err);
    });

    return () => unsubscribe();
  }, [initialJob]);

  // Handle dynamic resolution of parent/sibling joint-job images in real time
  const getResolvedPreviewImage = () => {
    // 1. Direct preview image
    if (job.previewImage) return { image: job.previewImage, sourceJob: job, isShared: false, sharedFromCode: '' };

    // 2. Resolve via joint relationships
    if (jobs && jobs.length > 0) {
      const isJobJoint = !!job.isJoint || job.items?.some(i => i.isJoint) || (job.platesUsed || []).some(p => p.isJoint);
      const jobRefCode = job.jointRef || job.items?.find(i => i.isJoint)?.paperRef || (job.platesUsed || []).find(p => p.isJoint)?.plateRef || '';
      const cleanRef = jobRefCode.trim().toUpperCase().replace('#', '');
      const currentJobCode = job.id.slice(-4).toUpperCase();

      // A. Check if there's a referenced master/parent job
      if (cleanRef) {
        const parent = jobs.find(j => j.id.slice(-4).toUpperCase() === cleanRef);
        if (parent?.previewImage) {
          return { image: parent.previewImage, sourceJob: parent, isShared: true, sharedFromCode: cleanRef };
        }
      }

      // B. Check if another job references THIS job as its joint parent, and has a preview image
      const childWithImage = jobs.find(j => {
        if (j.id === job.id) return false;
        const refCode = j.jointRef || j.items?.find(i => i.isJoint)?.paperRef || (j.platesUsed || []).find(p => p.isJoint)?.plateRef || '';
        const refClean = refCode.trim().toUpperCase().replace('#', '');
        return refClean === currentJobCode && j.previewImage;
      });

      if (childWithImage?.previewImage) {
        return { image: childWithImage.previewImage, sourceJob: childWithImage, isShared: true, sharedFromCode: childWithImage.id.slice(-4).toUpperCase() };
      }

      // C. Check if there's any other sibling job in the same joint group (same jointRef/paperRef/plateRef) that has a preview image
      if (cleanRef) {
        const siblingWithImage = jobs.find(j => {
          if (j.id === job.id) return false;
          const refCode = j.jointRef || j.items?.find(i => i.isJoint)?.paperRef || (j.platesUsed || []).find(p => p.isJoint)?.plateRef || '';
          const refClean = refCode.trim().toUpperCase().replace('#', '');
          return refClean === cleanRef && j.previewImage;
        });
        if (siblingWithImage?.previewImage) {
          return { image: siblingWithImage.previewImage, sourceJob: siblingWithImage, isShared: true, sharedFromCode: siblingWithImage.id.slice(-4).toUpperCase() };
        }
      }
    }

    return { image: '', sourceJob: job, isShared: false, sharedFromCode: '' };
  };

  const resolvedPreview = getResolvedPreviewImage();

  // Handle local image uploaded/dropped
  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file (PNG, JPG, JPEG)');
      return;
    }

    setIsUploading(true);

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target?.result as string;
      img.onload = async () => {
        // Downscale/compress using canvas to keep Firestore document size small (max 800px bounding box)
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);

          try {
            const jobRef = doc(db, 'jobs', job.id);
            await updateDoc(jobRef, { previewImage: compressedBase64 });
            toast.success('Artwork preview uploaded successfully!');
          } catch (err: any) {
            console.error(err);
            toast.error('Failed to save artwork preview to database');
          } finally {
            setIsUploading(false);
          }
        } else {
          setIsUploading(false);
          toast.error('Could not load image context');
        }
      };
      
      img.onerror = () => {
        setIsUploading(false);
        toast.error('Error loading image file');
      };
    };

    reader.onerror = () => {
      setIsUploading(false);
      toast.error('Error reading file');
    };
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const onFileSelectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const removeArtwork = async () => {
    try {
      // Remove from the actual source holding the image
      const targetJobId = resolvedPreview.sourceJob.id || job.id;
      const jobRef = doc(db, 'jobs', targetJobId);
      await updateDoc(jobRef, { previewImage: '' });
      toast.success('Artwork preview removed');
    } catch (err) {
      console.error(err);
      toast.error('Failed to remove artwork preview');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Resolve materials paper names
  const paperItems = job.items || [];
  const plates = job.platesUsed || [];
  const processCharges = job.processCharges || [];
  const isJobJoint = !!job.isJoint || job.items?.some(i => i.isJoint) || (job.platesUsed || []).some(p => p.isJoint);

  return (
    <>
      {/* Styles to inject print overriding rules */}
      <style>{`
        @media print {
          /* Hide all page contents */
          body > * {
            display: none !important;
          }
          /* Only display our customized job card container */
          #print-job-card-wrapper, #print-job-card-wrapper * {
            display: block !important;
            visibility: visible !important;
          }
          #print-job-card-wrapper {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            height: auto !important;
            background: #ffffff !important;
            color: #000000 !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }
          /* Reset paper styling inside print container */
          .print-border-thick {
            border: 3px double #000000 !important;
          }
          .print-border-thin {
            border-bottom: 1px calc(solid) #000000 !important;
          }
          .print-no-bg {
            background-color: transparent !important;
            border: 1px solid #000000 !important;
          }
          .print-hide {
            display: none !important;
          }
          .print-table th {
            font-weight: bold !important;
            background-color: #f7fafc !important;
            border: 1px solid #a0aec0 !important;
          }
          .print-table td {
            border: 1px solid #e2e8f0 !important;
          }
        }
      `}</style>

      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent id="aistudio-dialog-printpreview" className="sm:max-w-[850px] max-h-[92vh] overflow-y-auto rounded-[24px] border border-amber-100 bg-amber-50/5 p-0 md:p-0">
          <div className="flex flex-col h-full">
            
            {/* Modal Header Controls (Not Printed) */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-amber-50/20 rounded-t-[24px] print:hidden">
              <div>
                <DialogTitle className="font-serif text-xl font-bold text-amber-950 flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-[#5A5A40]" />
                  Job Production Card & Preview
                </DialogTitle>
                <p className="text-xs text-amber-900/60 font-sans mt-0.5">Specifications sheets & print layout verification ticket</p>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  onClick={handlePrint}
                  className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white rounded-full font-serif text-xs px-4 h-9 flex items-center gap-1.5 transition-colors"
                >
                  <Printer size={14} />
                  Print Job Ticket
                </Button>
              </div>
            </div>

            {/* Main Interactive Grid */}
            <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-y-auto">
              
              {/* Left Column: Job Printable Ticket (Double as Live Print Preview) */}
              <div className="lg:col-span-7 space-y-4 print:w-full">
                
                {/* Embedded Printable Area Wrapper */}
                <div 
                  id="print-job-card-wrapper" 
                  className="bg-white p-5 md:p-6 rounded-[20px] border border-gray-200/80 shadow-md font-sans max-w-2xl mx-auto print-border-thick print:shadow-none print:border-none print:mx-0 print:p-0"
                >
                  {/* Fine vintage double-border outer frame for job ticket aesthetic */}
                  <div className="border border-amber-900/10 p-4.5 rounded-lg space-y-5 print:border-none print:p-0">
                    
                    {/* Header: Company block */}
                    <div className="text-center space-y-1.5 pb-4 border-b-2 border-dashed border-gray-200 print-border-thin">
                      <h2 className="font-serif text-lg md:text-xl font-extrabold text-amber-950 uppercase tracking-widest leading-none">
                        {pressDetails.name}
                      </h2>
                      <p className="text-[10px] sm:text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                        {pressDetails.address}<br />
                        Ph: {pressDetails.phone} | Email: {pressDetails.email}
                      </p>
                      <div className="inline-block bg-[#5A5A40]/10 text-[#5A5A40] font-serif text-[11px] uppercase tracking-widest font-extrabold px-4 py-1 rounded-sm mt-1 print-no-bg">
                        Job Production Card
                      </div>
                    </div>

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-50/50 p-3 rounded-lg border border-gray-100 text-xs print-no-bg">
                      <div className="space-y-0.5">
                        <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">Job Code</span>
                        <p className="font-mono font-bold text-gray-900 text-sm">#{job.id.slice(-4).toUpperCase()}</p>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">Entry Date</span>
                        <p className="font-medium text-gray-800">{format(job.date, 'MMM dd, yyyy')}</p>
                      </div>
                      <div className="space-y-0.5 col-span-2">
                        <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">Ordered Qty</span>
                        <p className="font-mono font-extrabold text-emerald-700 text-sm">
                          {job.orderedQuantity ? `${job.orderedQuantity.toLocaleString()} Units` : 'N/A Bulk'}
                        </p>
                      </div>
                      <div className="space-y-0.5 col-span-2 border-t border-gray-100/60 pt-2 md:border-t-0 md:pt-0">
                        <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">Client / Party</span>
                        <p className="font-serif font-bold text-gray-900 text-sm truncate">{job.clientName}</p>
                      </div>
                      <div className="space-y-0.5 col-span-2 border-t border-gray-100/60 pt-2 md:border-t-0 md:pt-0">
                        <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">Job Description</span>
                        <p className="font-sans font-medium text-gray-700 text-xs truncate" title={job.jobDescription}>
                          {job.jobDescription}
                        </p>
                      </div>
                    </div>

                    {/* Specifications: Papers */}
                    <div className="space-y-2">
                      <h4 className="font-serif text-xs font-bold uppercase tracking-wider text-amber-950 flex items-center gap-1.5 pb-1 border-b border-gray-100">
                        <TableProperties className="h-3.5 w-3.5 text-[#5A5A40] print-hide" />
                        1. Paper & Material Specifications
                      </h4>
                      {paperItems.length === 0 ? (
                        <p className="text-gray-400 italic text-xs py-1">No paper items declared.</p>
                      ) : (
                        <div className="overflow-hidden border border-gray-100 rounded-lg bg-white print-no-bg">
                          <table className="w-full text-left border-collapse text-xs print-table">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="p-2 font-semibold text-gray-600">Stock Paper Name</th>
                                <th className="p-2 font-semibold text-gray-600 text-center">Sheets Consumed</th>
                                <th className="p-2 font-semibold text-gray-600 text-right">Job Type</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {paperItems.map((item, idx) => {
                                const stock = stocks.find(s => s.id === item.stockId);
                                return (
                                  <tr key={`print-spec-paper-${idx}`} className="hover:bg-gray-50/20">
                                    <td className="p-2 font-sans font-medium">
                                      {stock?.name || 'Unknown Stock'} 
                                      {stock?.gsm ? ` (${stock.gsm} GSM)` : ''}
                                      {stock?.size ? ` - ${stock.size}` : ''}
                                    </td>
                                    <td className="p-2 text-center font-mono font-medium">
                                      {item.quantityUsed.toLocaleString()} shs
                                    </td>
                                    <td className="p-2 text-right">
                                      {item.isJoint ? (
                                        <span className="text-amber-600 font-bold text-[10px] bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 print-no-bg">Joint</span>
                                      ) : (
                                        <span className="text-gray-400 text-[10px]">Standard</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Specifications: Plates */}
                    {plates.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-serif text-xs font-bold uppercase tracking-wider text-amber-950 flex items-center gap-1.5 pb-1 border-b border-gray-100">
                          2. Plates / CTP Processing
                        </h4>
                        <div className="overflow-hidden border border-gray-100 rounded-lg bg-white print-no-bg">
                          <table className="w-full text-left border-collapse text-xs print-table">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="p-2 font-semibold text-gray-600">Plate Specification</th>
                                <th className="p-2 font-semibold text-gray-600 text-center">Count</th>
                                <th className="p-2 font-semibold text-gray-600 text-right">Scope</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {plates.map((p, idx) => {
                                const stockPlate = stocks.find(s => s.id === p.plateId);
                                return (
                                  <tr key={`print-spec-plate-${idx}`} className="hover:bg-gray-50/20">
                                    <td className="p-2 font-sans font-medium">
                                      {stockPlate?.name || 'Standard CTP Plate'} 
                                      {stockPlate?.size ? ` (${stockPlate.size})` : ''}
                                    </td>
                                    <td className="p-2 text-center font-mono font-medium">
                                      {p.count} units
                                    </td>
                                    <td className="p-2 text-right">
                                      {p.isJoint ? (
                                        <span className="text-amber-600 font-bold text-[10px] bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 print-no-bg">Shared Plate</span>
                                      ) : isJobJoint ? (
                                        <span className="text-pink-600 font-bold text-[10px] bg-pink-50 px-1.5 py-0.5 rounded border border-pink-100 print-no-bg">Additional Plate</span>
                                      ) : (
                                        <span className="text-gray-400 text-[10px]">Individual</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Finishing & Process Operations */}
                    <div className="space-y-2">
                      <h4 className="font-serif text-xs font-bold uppercase tracking-wider text-amber-950 flex items-center gap-1.5 pb-1 border-b border-gray-100">
                        3. Finishing & Post-Press Operations
                      </h4>
                      {processCharges.length === 0 ? (
                        <p className="text-gray-400 italic text-xs py-1">No custom finishing processes designated.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {processCharges.map((pc) => (
                            <div key={`print-spec-process-${pc.id}`} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50/50 border border-gray-100 print-no-bg">
                              <span className="w-4 h-4 rounded-full border border-emerald-500 bg-emerald-50 text-emerald-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 print-no-bg">✓</span>
                              <div className="space-y-0.5">
                                <span className="font-medium text-gray-800">{pc.name}</span>
                                {pc.notes && (
                                  <p className="text-[10px] text-gray-500 italic leading-snug">Ref: {pc.notes}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Integrated Job Layout Artwork View (In ticket itself!) */}
                    {resolvedPreview.image && (
                      <div className="space-y-2 pt-2">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-1">
                          <h4 className="font-serif text-xs font-bold uppercase tracking-wider text-amber-950 flex items-center gap-1.5">
                            4. Verified Artwork Layout Preview
                          </h4>
                          {resolvedPreview.isShared && (
                            <span className="text-[10px] bg-amber-500/10 text-amber-800 font-bold px-2 py-0.5 rounded flex items-center gap-1 print:hidden">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Auto-linked from Joint Job #{resolvedPreview.sharedFromCode}
                            </span>
                          )}
                        </div>
                        <div className="border border-gray-200 p-2 rounded-xl bg-gray-50 flex items-center justify-center max-h-[220px] overflow-hidden print-no-bg print:max-h-none">
                          <img 
                            src={resolvedPreview.image} 
                            alt="Job artwork spec representation" 
                            className="max-h-[200px] object-contain rounded-lg print:max-h-fit print:w-[350px]"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </div>
                    )}

                    {/* Footer / Sign-off Block for Print */}
                    <div className="hidden border-t-2 border-dashed border-gray-200 pt-10 print:grid print:grid-cols-3 gap-6 text-center text-[10px] text-gray-500 mt-6">
                      <div className="border-t border-gray-400 pt-2">
                        <p className="font-medium text-gray-700">Compiled & Authorized By</p>
                        <p className="mt-5 font-serif italic text-[11px] text-gray-900">{pressDetails.name}</p>
                      </div>
                      <div className="border-t border-gray-400 pt-2">
                        <p className="font-medium text-gray-700">Customer Proof Approval</p>
                        <p className="mt-5 text-gray-400">[Customer Seal / Signature]</p>
                      </div>
                      <div className="border-t border-gray-400 pt-2">
                        <p className="font-medium text-gray-700">Compositor / Press Operator</p>
                        <p className="mt-5 text-gray-400">[Job Completed Date/Sign]</p>
                      </div>
                    </div>

                  </div>
                </div>
              </div>

              {/* Right Column: Interaction Controls (Uploading new Proof + Guides) */}
              <div className="lg:col-span-5 space-y-4 print:hidden">
                <Card className="border border-amber-100/60 bg-amber-50/20 rounded-[20px]">
                  <CardHeader className="pb-3">
                    <CardTitle className="font-serif text-base text-amber-950 flex items-center gap-1.5">
                      <ImageIcon className="h-4 w-4 text-[#5A5A40]" />
                      Job Proof Upload Control
                    </CardTitle>
                    <p className="text-xs text-amber-900/60">Attach mechanical artwork, layout draft, or color proof designs for this printing order.</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    
                    {/* Drag and Drop Container */}
                    <div
                      onDragOver={onDragOver}
                      onDragLeave={onDragLeave}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`relative border-2 border-dashed rounded-[16px] p-6 text-center cursor-pointer transition-all ${
                        isDragging 
                          ? 'border-[#5A5A40] bg-amber-50/40 scale-[0.98]' 
                          : 'border-amber-200/60 hover:border-[#5A5A40] hover:bg-white bg-white/50'
                      }`}
                    >
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={onFileSelectChange} 
                        accept="image/*" 
                        className="hidden" 
                      />
                      
                      {isUploading ? (
                        <div className="space-y-3 py-4 flex flex-col items-center justify-center">
                          <Loader2 className="h-10 w-10 text-[#5A5A40] animate-spin" />
                          <p className="text-xs font-serif font-semibold text-amber-950">Downscaling & saving to database...</p>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          <div className="mx-auto w-11 h-11 rounded-full bg-amber-50 flex items-center justify-center text-[#5A5A40]">
                            <Upload className="h-5.5 w-5.5" />
                          </div>
                          <div>
                            <p className="text-xs font-bold font-serif text-amber-950">Drag & drop layout proof here</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">or tap to choose file from system</p>
                          </div>
                          <p className="text-[9px] text-[#5A5A40]/70 uppercase tracking-widest font-sans font-medium bg-amber-50 inline-block px-2.5 py-0.5 rounded-full">
                            Autosaved to database
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Selected Image Info and Quick Actions */}
                    {resolvedPreview.image ? (
                      <div className="p-3 bg-white rounded-xl border border-amber-100 flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center shrink-0">
                              <img src={resolvedPreview.image} alt="Artwork thumbnail" className="w-full h-full object-cover" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-serif font-bold text-amber-950 truncate flex items-center gap-1">
                                <FileImage size={13} className="text-emerald-600" />
                                Art_Proof_#{resolvedPreview.sourceJob.id.slice(-4).toUpperCase()}.jpg
                              </p>
                              <p className="text-[10px] text-emerald-600 font-bold">
                                {resolvedPreview.isShared ? '✓ Shared from linked joint job' : '✓ Attached directly to job'}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost" 
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeArtwork();
                            }}
                            className="h-8 w-8 text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-0 rounded-full shrink-0"
                            title="Delete proof image from database"
                          >
                            <Trash2Icon className="h-4 w-4" />
                          </Button>
                        </div>
                        {resolvedPreview.isShared && (
                          <div className="text-[11px] text-amber-800 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5 leading-relaxed">
                            <strong>Joint job detected:</strong> Since this job behaves jointly with job <strong>#{resolvedPreview.sharedFromCode}</strong>, its layout proof image is shared dynamically. Edits or deletion will affect the primary record.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center p-4 bg-gray-50/50 border border-dashed border-gray-100 rounded-xl italic text-xs text-gray-400">
                        No layout proof image uploaded. The job card remains standard specs.
                      </div>
                    )}
                    
                  </CardContent>
                </Card>

                <div className="bg-amber-50/35 border border-amber-100 p-4 rounded-[20px] space-y-3.5">
                  <h5 className="text-[11px] uppercase tracking-wider font-extrabold text-amber-950 font-serif">A Note on Proof Verification</h5>
                  <div className="space-y-2 text-xs text-amber-900/80 leading-relaxed font-sans">
                    <p className="flex items-start gap-1.5">
                      <span className="text-[#5A5A40] font-bold">1.</span>
                      <span>Attach image previews to keep a digital record of customer-approved proofs.</span>
                    </p>
                    <p className="flex items-start gap-1.5">
                      <span className="text-[#5A5A40] font-bold">2.</span>
                      <span>The image is automatically resized and compressed on the client side so it saves instantly in Firestore without storage limits.</span>
                    </p>
                    <p className="flex items-start gap-1.5">
                      <span className="text-[#5A5A40] font-bold">3.</span>
                      <span>When printing the Job Card using the **Print Job Ticket** button, the attached image prints inline, allowing your mechanical operators to confirm the printed job design directly on the factory floor.</span>
                    </p>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Simple Trash icon substitute to hook up trash functionality without other imports
function Trash2Icon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}
