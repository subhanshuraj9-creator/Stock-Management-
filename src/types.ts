export type StockType = 'paper' | 'board' | 'ink' | 'plate';

export interface StockItem {
  id: string;
  name: string;
  gsm?: number; // Optional for ink/plate
  size?: string; // Optional for ink
  quantity: number; // in sheets, kg (total), or units
  inkContainers?: { weight: number; count: number }[]; // For ink: weight and number of containers
  type: StockType;
  lastUpdated: number;
  defaultRate?: number; // Optional default unit rate/charge for ledger billing
  paperType?: string; // e.g., 'Art Paper', 'Maplitho', etc.
  unit?: string;
  brand?: string;
  millName?: string;
  shade?: string;
  notes?: string;
}

export interface JobItem {
  stockId: string;
  quantityUsed: number; // Actual Sheets Used
  ups?: number; // Matter Ups
  allocatedPaper?: number; // Auto calculated
  isJoint?: boolean;
  paperRef?: string;
  paperRate?: number; // Optional paper rate/estimate per sheet
  wastageSheets?: number; // Wastage Sheets
}

export interface Job {
  id: string;
  clientName: string;
  jobDescription: string;
  date: number;
  items: JobItem[];
  platesUsed?: { 
    plateId: string; 
    count: number; 
    isJoint?: boolean; // If true: no stock deduction! Shared across parties
    plateRef?: string; // Reference tag of the joint plate to link jobs (e.g. "P-042")
    rate?: number; // Rate per plate for party ledger
    isJointRef?: boolean;
    refJobId?: string;
    isReused?: boolean; // If true: reused/repeat plate, no stock deduction
    isCancelled?: boolean; // If true: cancelled plate (consumes stock, client IS charged, cannot be reused in repeat/future jobs)
    cancelledColor?: 'C' | 'M' | 'Y' | 'K' | ''; // Selected color channel for cancelled plate
    isAdditionalPlate?: boolean; // If true: added as an additional/replacement plate
  }[];
  processCharges?: ProcessCharge[];
  lamination?: {
    halfEnabled: boolean;
    halfQty?: number;
    halfRate?: number;
    fullEnabled: boolean;
    fullQty?: number;
    fullRate?: number;
  };
  orderedQuantity?: number; // Total bulk quantity ordered (e.g. 10000 brochures)
  dispatches?: DispatchRecord[]; // Direct partial dispatch tracking logs
  dispatchStatus?: 'pending' | 'partial' | 'completed'; // Computed or manually adjusted status
  isJoint?: boolean; // If true, the whole job is joint
  jointJobType?: 'master' | 'linked'; // Joint Job Type
  sharedRunId?: string; // Generated shared run ID (e.g., JR001) Shared across Joint Jobs
  jointRef?: string; // Reference of the joint job to link other jobs (or shortId)
  isRepeat?: boolean; // If true, the whole job is a repeat job
  repeatRef?: string; // Reference of the parent job for repeat
  previewImage?: string; // Base64 representation of job artwork/proof image for preview
  jointParentId?: string;
  paperBillingMethod?: '100sheets' | 'gross' | 'ream' | 'custom' | '';
  paperBillingRate?: number;
  paperBillingAmount?: number;
}

export interface JointRun {
  id: string;
  sharedRunId: string;
  paper: {
    stockId: string;
    paperSize?: string;
    paperSection?: string;
    paperNotes?: string;
    productionNotes?: string;
    paperRate?: number;
  };
  totalSheetsUsed: number;
  wastageSheets: number;
  sharedPlates: {
    plateId: string;
    count: number;
    rate?: number;
    isJoint?: boolean;
    isJointRef?: boolean;
    plateRef?: string;
  }[];
  linkedJobs: string[];
}

export interface JointRunAuditLog {
  id: string;
  sharedRunId: string;
  userEmail: string;
  changedField: string;
  oldValue: any;
  newValue: any;
  affectedJobs: string[];
  timestamp: number;
}

export interface DispatchRecord {
  id: string;
  date: number;
  quantityShipped: number;
  receiverName?: string;
  notes?: string;
}

export interface ProcessCharge {
  id: string; // unique ID or simple identifier
  name: string; // e.g. "Cutting", "Folding", "Binding", "Lamination", "UV", etc.
  amount: number;
  notes?: string;
}

export interface Payment {
  id: string;
  clientName: string;
  amount: number;
  date: number;
  notes?: string;
}

export interface InkUsage {
  id: string;
  inkId: string;
  date: number;
  weight: number;
  count: number;
  notes?: string;
}

export interface StockHistory {
  id: string;
  stockId: string;
  date: number;
  type: 'addition' | 'usage';
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  notes?: string;
  purchaseRate?: number;
  supplier?: string;
  invoiceNo?: string;
  jobId?: string;
}
