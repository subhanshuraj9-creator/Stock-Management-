import { initializeApp } from 'firebase/app';
import { getAuth, signOut, signInWithEmailAndPassword } from 'firebase/auth';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  doc, 
  getDocFromServer 
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Initialize Firestore with robust multi-tab persistent cache.
// Serves reads from local cache first if they haven't changed,
// significantly reducing Firestore quota reads and keeping the application
// operational if Quota Exceeded error is encountered.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const storage = getStorage(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  const isQuota = errInfo.error.toLowerCase().includes('quota') || 
                  errInfo.error.toLowerCase().includes('resource_exhausted') || 
                  errInfo.error.toLowerCase().includes('free daily read units') || 
                  errInfo.error.toLowerCase().includes('free tier database');

  if (isQuota) {
    console.warn('Firestore Quota Warning: ', JSON.stringify(errInfo));
    if (operationType === OperationType.LIST || operationType === OperationType.GET) {
      console.warn("Firestore Read Quota Exceeded. The application is running in multi-tab local cache mode fallback.");
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('firestore-quota-warning', { detail: errInfo }));
      }
      return; // Suppress & don't throw to prevent triggering ErrorBoundary, keeping cached data visible
    }
  } else {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }

  throw new Error(JSON.stringify(errInfo));
}

export function cleanUndefined<T>(obj: T): T {
  if (obj === undefined) {
    return null as any;
  }
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => cleanUndefined(item)) as any;
  }
  const result: any = {};
  for (const key of Object.keys(obj as any)) {
    const val = (obj as any)[key];
    if (val !== undefined) {
      result[key] = cleanUndefined(val);
    }
  }
  return result;
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}

testConnection();

export const logout = () => signOut(auth);
