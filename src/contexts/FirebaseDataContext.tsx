import React, { createContext, useContext, useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { StockItem, Job, JointRun, JointRunAuditLog, Payment, InkUsage, StockHistory, PartyOpeningBalance, Expense } from '../types';

interface FirebaseData {
  stocks: StockItem[];
  jobs: Job[];
  payments: Payment[];
  stockHistory: StockHistory[];
  expenses: Expense[];
  inkUsages: InkUsage[];
  paperSections: { id: string; name: string }[];
  boardSections: { id: string; name: string }[];
  jointRuns: JointRun[];
  auditLogs: JointRunAuditLog[];
  partyOpeningBalances: PartyOpeningBalance[];
  loading: boolean;
  stocksLoaded: boolean;
  jobsLoaded: boolean;
  paymentsLoaded: boolean;
  historyLoaded: boolean;
  expensesLoaded: boolean;
  inkUsagesLoaded: boolean;
  paperSectionsLoaded: boolean;
  boardSectionsLoaded: boolean;
  jointRunsLoaded: boolean;
  auditLogsLoaded: boolean;
  partyBalancesLoaded: boolean;
}

const FirebaseDataContext = createContext<FirebaseData | undefined>(undefined);

export const FirebaseDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stockHistory, setStockHistory] = useState<StockHistory[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [inkUsages, setInkUsages] = useState<InkUsage[]>([]);
  const [paperSections, setPaperSections] = useState<{ id: string; name: string }[]>([]);
  const [boardSections, setBoardSections] = useState<{ id: string; name: string }[]>([]);
  const [jointRuns, setJointRuns] = useState<JointRun[]>([]);
  const [auditLogs, setAuditLogs] = useState<JointRunAuditLog[]>([]);
  const [partyOpeningBalances, setPartyOpeningBalances] = useState<PartyOpeningBalance[]>([]);

  const [stocksLoaded, setStocksLoaded] = useState(false);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [expensesLoaded, setExpensesLoaded] = useState(false);
  const [inkUsagesLoaded, setInkUsagesLoaded] = useState(false);
  const [paperSectionsLoaded, setPaperSectionsLoaded] = useState(false);
  const [boardSectionsLoaded, setBoardSectionsLoaded] = useState(false);
  const [jointRunsLoaded, setJointRunsLoaded] = useState(false);
  const [auditLogsLoaded, setAuditLogsLoaded] = useState(false);
  const [partyBalancesLoaded, setPartyBalancesLoaded] = useState(false);

  useEffect(() => {
    // 1. Stocks
    const unsubscribeStocks = onSnapshot(
      query(collection(db, 'stocks'), orderBy('lastUpdated', 'desc')),
      (snapshot) => {
        setStocks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockItem)));
        setStocksLoaded(true);
      },
      (error) => {
        console.error('Stocks sync error:', error);
        handleFirestoreError(error, OperationType.LIST, 'stocks');
      }
    );

    // 2. Jobs
    const unsubscribeJobs = onSnapshot(
      query(collection(db, 'jobs'), orderBy('date', 'desc')),
      (snapshot) => {
        setJobs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Job)));
        setJobsLoaded(true);
      },
      (error) => {
        console.error('Jobs sync error:', error);
        handleFirestoreError(error, OperationType.LIST, 'jobs');
      }
    );

    // 3. Payments
    const unsubscribePayments = onSnapshot(
      query(collection(db, 'payments'), orderBy('date', 'desc')),
      (snapshot) => {
        setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
        setPaymentsLoaded(true);
      },
      (error) => {
        console.error('Payments sync error:', error);
        handleFirestoreError(error, OperationType.LIST, 'payments');
      }
    );

    // 4. Stock History
    const unsubscribeHistory = onSnapshot(
      query(collection(db, 'stockHistory'), orderBy('date', 'desc')),
      (snapshot) => {
        setStockHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockHistory)));
        setHistoryLoaded(true);
      },
      (error) => {
        console.error('Stock History sync error:', error);
        handleFirestoreError(error, OperationType.LIST, 'stockHistory');
      }
    );

    // 5. Expenses
    const unsubscribeExpenses = onSnapshot(
      query(collection(db, 'expenses'), orderBy('date', 'desc')),
      (snapshot) => {
        setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense)));
        setExpensesLoaded(true);
      },
      (error) => {
        console.error('Expenses sync error:', error);
        handleFirestoreError(error, OperationType.LIST, 'expenses');
      }
    );

    // 6. Ink Usage
    const unsubscribeInkUsage = onSnapshot(
      query(collection(db, 'inkUsage'), orderBy('date', 'desc')),
      (snapshot) => {
        setInkUsages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InkUsage)));
        setInkUsagesLoaded(true);
      },
      (error) => {
        console.error('Ink Usage sync error:', error);
        handleFirestoreError(error, OperationType.LIST, 'inkUsage');
      }
    );

    // 7. Paper Sections
    const unsubscribePaperSections = onSnapshot(
      query(collection(db, 'paperSections'), orderBy('name', 'asc')),
      (snapshot) => {
        setPaperSections(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name as string })));
        setPaperSectionsLoaded(true);
      },
      (error) => console.error('Paper Sections sync error:', error)
    );

    // 8. Board Sections
    const unsubscribeBoardSections = onSnapshot(
      query(collection(db, 'boardSections'), orderBy('name', 'asc')),
      (snapshot) => {
        setBoardSections(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name as string })));
        setBoardSectionsLoaded(true);
      },
      (error) => console.error('Board Sections sync error:', error)
    );

    // 9. Joint Runs
    const unsubscribeJointRuns = onSnapshot(
      collection(db, 'jointRuns'),
      (snapshot) => {
        setJointRuns(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JointRun)));
        setJointRunsLoaded(true);
      },
      (error) => {
        console.error('Joint Runs sync error:', error);
        handleFirestoreError(error, OperationType.LIST, 'jointRuns');
      }
    );

    // 10. Joint Run Audit Logs
    const unsubscribeAuditLogs = onSnapshot(
      collection(db, 'jointRunAuditLogs'),
      (snapshot) => {
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JointRunAuditLog));
        setAuditLogs([...logs].sort((a, b) => b.timestamp - a.timestamp));
        setAuditLogsLoaded(true);
      },
      (error) => console.warn('Joint Run Audit Logs sync error:', error)
    );

    // 11. Party Opening Balances
    const unsubscribePartyBalances = onSnapshot(
      collection(db, 'partyOpeningBalances'),
      (snapshot) => {
        setPartyOpeningBalances(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PartyOpeningBalance)));
        setPartyBalancesLoaded(true);
      },
      (error) => console.error('Party Balances sync error:', error)
    );

    return () => {
      unsubscribeStocks();
      unsubscribeJobs();
      unsubscribePayments();
      unsubscribeHistory();
      unsubscribeExpenses();
      unsubscribeInkUsage();
      unsubscribePaperSections();
      unsubscribeBoardSections();
      unsubscribeJointRuns();
      unsubscribeAuditLogs();
      unsubscribePartyBalances();
    };
  }, []);

  const loading = !(
    stocksLoaded &&
    jobsLoaded &&
    paymentsLoaded &&
    historyLoaded &&
    expensesLoaded &&
    inkUsagesLoaded &&
    jointRunsLoaded
  );

  return (
    <FirebaseDataContext.Provider
      value={{
        stocks,
        jobs,
        payments,
        stockHistory,
        expenses,
        inkUsages,
        paperSections,
        boardSections,
        jointRuns,
        auditLogs,
        partyOpeningBalances,
        loading,
        stocksLoaded,
        jobsLoaded,
        paymentsLoaded,
        historyLoaded,
        expensesLoaded,
        inkUsagesLoaded,
        paperSectionsLoaded,
        boardSectionsLoaded,
        jointRunsLoaded,
        auditLogsLoaded,
        partyBalancesLoaded,
      }}
    >
      {children}
    </FirebaseDataContext.Provider>
  );
};

export const useFirebaseData = () => {
  const context = useContext(FirebaseDataContext);
  if (context === undefined) {
    throw new Error('useFirebaseData must be used within a FirebaseDataProvider');
  }
  return context;
};
