import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '@/firebase-applet-config.json';

// Initialize Firebase App singleton
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Connect to the specific provisioned Firestore database ID
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Blueprint constraint constants synchronized with firebase-blueprint.json & firestore.rules
export const FIREBASE_CONSTRAINTS = {
  ID_REGEX: /^[a-zA-Z0-9_-]{1,128}$/,
  USERNAME_REGEX: /^[a-z0-9_]{3,32}$/,
  MAX_DISPLAY_NAME: 80,
  MAX_AVATAR_URL: 1024,
  MAX_BIO: 300,
  MAX_GENDER: 32,
  MAX_COUNTRY: 64,
  MAX_EMAIL: 254,
  MAX_PHONE: 32,
  MAX_GROUP_NAME: 100,
  MAX_GROUP_DESC: 500,
  MAX_MESSAGE_CONTENT: 8000,
  MAX_LAST_MESSAGE_PREVIEW: 4000,
  MAX_SDP_LEN: 20000,
  MAX_CANDIDATE_LEN: 2048,
  MAX_REPORT_CATEGORY: 64,
  MAX_REPORT_DESC: 3000,
} as const;

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
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    // Other errors (such as permission-denied prior to sign-in or missing doc) do not indicate offline config failure
  }
}

// Execute connection probe on startup
if (typeof window !== 'undefined') {
  void testConnection();
}

export function isFirebaseSessionActive(userId?: string): boolean {
  const current: FirebaseUser | null = auth.currentUser;
  if (!current) return false;
  if (userId && current.uid !== userId) return false;
  return true;
}

export function tsToIso(value: unknown, fallback?: string): string {
  if (!value) return fallback || new Date().toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof (value as any)?.toDate === 'function') {
    return (value as any).toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Date(value).toISOString();
  return fallback || new Date().toISOString();
}

export function sanitizeStr(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

export function sanitizeOptionalStr(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

export function sanitizeUsername(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);
}

export function isValidFirestoreId(value: string): boolean {
  return FIREBASE_CONSTRAINTS.ID_REGEX.test(value);
}
