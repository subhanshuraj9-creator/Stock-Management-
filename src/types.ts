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
}

export interface JobItem {
  stockId: string;
  quantityUsed: number; // Actual Sheets Consumed
  rate?: number; // Rate per sheet/unit for ledger billing
  ups?: number; // Matter Per Sheet (Ups)
  autoCalculate?: boolean; // Whether sheets required is auto-calculated
  calculatedSheets?: number; // Calculated Sheets Required
  isJoint?: boolean; // If true: no stock deduction! Shared across parties
  paperRef?: string; // Reference of joint paper to link jobs
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
    isCancelled?: boolean; // If true: cancelled plate (consumes stock, excluded from invoice/ledger)
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
  jointRef?: string; // Reference of the joint job to link other jobs
  previewImage?: string; // Base64 representation of job artwork/proof image for preview
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
}
