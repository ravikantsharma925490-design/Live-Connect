import { getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '@/firebase-applet-config.json';

const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

export function isOfflineOrUnavailableError(err: unknown): boolean {
  if (!err) return false;
  const code = String((err as any)?.code || '').toLowerCase();
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    msg.includes('the client is offline') ||
    msg.includes('client is offline') ||
    msg.includes('could not reach cloud firestore backend') ||
    msg.includes('backend didn\'t respond') ||
    msg.includes('network-request-failed')
  );
}

async function getOptionalIdToken(): Promise<string | null> {
  try {
    if (getApps().length === 0) return null;
    const auth = getAuth(getApp());
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
  } catch {
    return null;
  }
}

async function buildHeaders(includeJsonContentType = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'x-goog-api-key': firebaseConfig.apiKey,
  };
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  const token = await getOptionalIdToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function decodeFirestoreValue(val: any): any {
  if (!val || typeof val !== 'object') return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('arrayValue' in val) {
    const items = Array.isArray(val.arrayValue?.values) ? val.arrayValue.values : [];
    return items.map(decodeFirestoreValue);
  }
  if ('mapValue' in val) {
    return decodeFirestoreFields(val.mapValue?.fields || {});
  }
  return null;
}

export function decodeFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}

function encodeFirestoreValue(val: unknown): Record<string, any> {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => encodeFirestoreValue(item)),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function encodeFirestoreFields(obj: Record<string, unknown>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = encodeFirestoreValue(v);
    }
  }
  return fields;
}

function buildRestError(statusCode: number, body: any, fallbackMsg: string): Error {
  const apiStatus = String(body?.error?.status || '').toLowerCase().replace(/_/g, '-');
  const message = String(body?.error?.message || fallbackMsg);
  const err = new Error(message) as Error & { code?: string };
  if (apiStatus) {
    err.code = apiStatus;
  } else if (statusCode === 403) {
    err.code = 'permission-denied';
  } else if (statusCode === 404) {
    err.code = 'not-found';
  }
  return err;
}

export async function restProbeConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  try {
    const headers = await buildHeaders(false);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
    const res = await fetch(`${FIRESTORE_BASE_URL}/test/connection`, {
      method: 'GET',
      headers,
      signal: controller?.signal,
    });
    if (timer) clearTimeout(timer);
    // Any valid Firestore server response (200, 403, 404) proves Firebase project & DB config are valid
    return res.status === 200 || res.status === 403 || res.status === 404;
  } catch {
    return false;
  }
}

export async function restGetDocument(
  docPath: string
): Promise<{ exists: boolean; data?: Record<string, any> }> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const headers = await buildHeaders(false);
  const res = await fetch(`${FIRESTORE_BASE_URL}/${cleanPath}`, {
    method: 'GET',
    headers,
  });

  if (res.status === 404) {
    return { exists: false };
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw buildRestError(res.status, json, `Firestore REST GET failed (${res.status})`);
  }

  return {
    exists: true,
    data: decodeFirestoreFields(json?.fields || {}),
  };
}

export interface RestWriteOperation {
  type: 'set' | 'update' | 'delete';
  path: string;
  data?: Record<string, unknown>;
  serverTimestampFields?: string[];
  updateMaskFields?: string[];
}

export async function restCommitWrites(ops: RestWriteOperation[]): Promise<void> {
  if (ops.length === 0) return;

  const docNamePrefix = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
  const writes = ops.map((op) => {
    const cleanPath = op.path.replace(/^\/+/, '');
    const fullName = `${docNamePrefix}/${cleanPath}`;

    if (op.type === 'delete') {
      return { delete: fullName };
    }

    const encodedFields = encodeFirestoreFields(op.data || {});
    const writeObj: Record<string, any> = {
      update: {
        name: fullName,
        fields: encodedFields,
      },
    };

    if (op.type === 'update') {
      const maskFields =
        op.updateMaskFields && op.updateMaskFields.length > 0
          ? op.updateMaskFields
          : Object.keys(op.data || {});
      writeObj.updateMask = { fieldPaths: maskFields };
      writeObj.currentDocument = { exists: true };
    }

    if (op.serverTimestampFields && op.serverTimestampFields.length > 0) {
      writeObj.updateTransforms = op.serverTimestampFields.map((fieldPath) => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      }));
    }

    return writeObj;
  });

  const headers = await buildHeaders(true);
  const res = await fetch(`${FIRESTORE_BASE_URL}:commit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ writes }),
  });

  if (!res.ok) {
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    throw buildRestError(res.status, json, `Firestore REST commit failed (${res.status})`);
  }
}
