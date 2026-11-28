import fs from 'fs';
import path from 'path';

let cachedFsConfig: { projectId: string; databaseId: string } | null = null;

export function getFirestoreConfig(): { projectId: string; databaseId: string } | null {
  if (cachedFsConfig) return cachedFsConfig;
  try {
    const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!raw?.projectId) return null;
    cachedFsConfig = {
      projectId: String(raw.projectId),
      databaseId: String(raw.firestoreDatabaseId || '(default)'),
    };
    return cachedFsConfig;
  } catch {
    return null;
  }
}

export function fromFsValue(val: any): any {
  if (!val || typeof val !== 'object') return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('arrayValue' in val) {
    const arr = val.arrayValue?.values || [];
    return arr.map((item: any) => fromFsValue(item));
  }
  if ('mapValue' in val) {
    const fields = val.mapValue?.fields || {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFsValue(v);
    }
    return out;
  }
  return null;
}

export function toFsValue(val: any, timestampKeys?: Set<string>, keyName?: string): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (typeof val === 'string') {
    if (timestampKeys && keyName && timestampKeys.has(keyName) && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
      return { timestampValue: val };
    }
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFsValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFsValue(v, timestampKeys, k);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function parseFsDoc(docObj: any): { id: string; path: string; data: Record<string, any> } | null {
  if (!docObj?.name) return null;
  const parts = String(docObj.name).split('/');
  const id = parts[parts.length - 1] || '';
  const data: Record<string, any> = {};
  const fields = docObj.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    data[k] = fromFsValue(v);
  }
  return { id, path: docObj.name, data };
}

function getBaseUrl(): string | null {
  const cfg = getFirestoreConfig();
  if (!cfg) return null;
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(cfg.databaseId)}/documents`;
}

export async function fsRestListCollection(
  idToken: string | null | undefined,
  collectionPath: string,
  pageSize = 200
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const base = getBaseUrl();
  if (!base || !idToken || idToken.split('.').length !== 3) return [];
  try {
    const cleanPath = collectionPath.replace(/^\/+/, '');
    const resp = await fetch(`${base}/${cleanPath}?pageSize=${Math.min(300, pageSize)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!resp.ok) return [];
    const json = (await resp.json()) as { documents?: any[] };
    const docs = Array.isArray(json.documents) ? json.documents : [];
    return docs
      .map((d) => parseFsDoc(d))
      .filter(Boolean)
      .map((d) => ({ id: d!.id, data: d!.data }));
  } catch {
    return [];
  }
}

export async function fsRestGetDoc(
  idToken: string | null | undefined,
  docPath: string
): Promise<Record<string, any> | null> {
  const base = getBaseUrl();
  if (!base || !idToken || idToken.split('.').length !== 3) return null;
  try {
    const cleanPath = docPath.replace(/^\/+/, '');
    const resp = await fetch(`${base}/${cleanPath}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const parsed = parseFsDoc(json);
    return parsed ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function fsRestSetOrPatchDoc(
  idToken: string | null | undefined,
  docPath: string,
  fieldsObj: Record<string, any>,
  options?: { updateMask?: string[]; timestampKeys?: string[] }
): Promise<boolean> {
  const base = getBaseUrl();
  if (!base || !idToken || idToken.split('.').length !== 3) return false;
  try {
    const cleanPath = docPath.replace(/^\/+/, '');
    const tsSet = new Set(options?.timestampKeys || ['createdAt', 'updatedAt', 'lastSeen', 'respondedAt']);
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(fieldsObj)) {
      if (v !== undefined) {
        fields[k] = toFsValue(v, tsSet, k);
      }
    }
    const qs = options?.updateMask?.length
      ? `?${options.updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')}`
      : '';
    const resp = await fetch(`${base}/${cleanPath}${qs}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function fsRestDeleteDoc(
  idToken: string | null | undefined,
  docPath: string
): Promise<boolean> {
  const base = getBaseUrl();
  if (!base || !idToken || idToken.split('.').length !== 3) return false;
  try {
    const cleanPath = docPath.replace(/^\/+/, '');
    const resp = await fetch(`${base}/${cleanPath}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function fsRestListAllCollection(
  idToken: string | null | undefined,
  collectionPath: string,
  maxTotal = 5000
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const base = getBaseUrl();
  if (!base || !idToken || idToken.split('.').length !== 3) return [];
  const cleanPath = collectionPath.replace(/^\/+/, '');
  const results: Array<{ id: string; data: Record<string, any> }> = [];
  let pageToken = '';

  try {
    while (results.length < maxTotal) {
      const pageSize = Math.min(300, maxTotal - results.length);
      const url = `${base}/${cleanPath}?pageSize=${pageSize}${
        pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
      }`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!resp.ok) break;
      const json = (await resp.json()) as { documents?: any[]; nextPageToken?: string };
      const docs = Array.isArray(json.documents) ? json.documents : [];
      for (const d of docs) {
        const parsed = parseFsDoc(d);
        if (parsed) {
          results.push({ id: parsed.id, data: parsed.data });
        }
      }
      if (!json.nextPageToken || docs.length === 0) break;
      pageToken = json.nextPageToken;
    }
  } catch {
    // Return partial collected docs on network interruption
  }
  return results;
}

export async function fsRestCommitBatchWrites(
  idToken: string | null | undefined,
  ops: Array<{ docPath: string; fields: Record<string, any>; timestampKeys?: string[] }>
): Promise<number> {
  const cfg = getFirestoreConfig();
  const base = getBaseUrl();
  if (!cfg || !base || !idToken || idToken.split('.').length !== 3 || ops.length === 0) return 0;

  let succeeded = 0;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(cfg.databaseId)}/documents:commit`;
  const docPrefix = `projects/${cfg.projectId}/databases/${cfg.databaseId}/documents`;

  // Firestore :commit supports up to 500 writes per request; use 200-doc batches safely
  const BATCH_SIZE = 200;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const chunk = ops.slice(i, i + BATCH_SIZE);
    const writes = chunk.map((op) => {
      const cleanPath = op.docPath.replace(/^\/+/, '');
      const tsSet = new Set(op.timestampKeys || ['createdAt', 'updatedAt']);
      const fields: Record<string, any> = {};
      for (const [k, v] of Object.entries(op.fields)) {
        if (v !== undefined) {
          fields[k] = toFsValue(v, tsSet, k);
        }
      }
      return {
        update: {
          name: `${docPrefix}/${cleanPath}`,
          fields,
        },
      };
    });

    try {
      const resp = await fetch(commitUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ writes }),
      });
      if (resp.ok) {
        succeeded += chunk.length;
      }
    } catch {
      // Continue remaining batches on single batch error
    }
  }

  return succeeded;
}
