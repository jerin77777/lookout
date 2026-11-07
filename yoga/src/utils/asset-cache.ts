/**
 * Universal client-side asset caching using IndexedDB with CacheStorage fallback.
 * Works seamlessly across HTTP, HTTPS, Nginx, localhost, and mobile WebViews.
 */

const DB_NAME = 'vyom_asset_cache_v2';
const STORE_NAME = 'assets';
const CACHE_STORAGE_NAME = 'vyom-glb-cache-v2';

// Open / initialize IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in this environment'));
    }

    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event: any) => {
      resolve(event.target.result);
    };

    request.onerror = (event: any) => {
      reject(event.target.error || new Error('Failed to open IndexedDB'));
    };
  });
}

// Get asset from IndexedDB
export async function getFromIndexedDB(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        if (request.result && request.result instanceof ArrayBuffer) {
          resolve(request.result);
        } else if (request.result && request.result.buffer instanceof ArrayBuffer) {
          resolve(request.result.buffer);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  } catch (err) {
    return null;
  }
}

// Save asset to IndexedDB
export async function saveToIndexedDB(key: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data, key);

      request.onsuccess = () => resolve();
      request.onerror = (e: any) => reject(e.target.error);
    });
  } catch (err) {
    console.warn('[AssetCache] Failed to save to IndexedDB:', err);
  }
}

/**
 * Fetches an asset with persistent client-side caching.
 * Hierarchy:
 *  1. IndexedDB (fastest, works on HTTP & HTTPS, all origins)
 *  2. CacheStorage (if available)
 *  3. Network Fetch with progress tracking -> writes back to IndexedDB & CacheStorage
 */
export async function fetchAndCacheAsset(
  url: string,
  onProgress?: (percent: number) => void
): Promise<ArrayBuffer> {
  // 1. Try IndexedDB first
  try {
    const cachedBuffer = await getFromIndexedDB(url);
    if (cachedBuffer && cachedBuffer.byteLength > 0) {
      console.log(
        `[3D Cache] Loaded ${url} (${(cachedBuffer.byteLength / 1024 / 1024).toFixed(2)} MB) directly from local IndexedDB cache.`
      );
      if (onProgress) onProgress(100);
      return cachedBuffer;
    }
  } catch (err) {
    console.warn('[3D Cache] IndexedDB check failed, trying fallback...', err);
  }

  // 2. Try CacheStorage if available
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_STORAGE_NAME);
      const cachedRes = await cache.match(url);
      if (cachedRes) {
        console.log(`[3D Cache] Loaded ${url} from CacheStorage.`);
        const buffer = await cachedRes.arrayBuffer();
        if (onProgress) onProgress(100);
        // Also mirror to IndexedDB for subsequent instant loads
        saveToIndexedDB(url, buffer).catch(() => {});
        return buffer;
      }
    } catch (cacheErr) {
      // Ignore cache storage errors on insecure contexts
    }
  }

  // 3. Fetch from network with progress tracking
  console.log(`[3D Cache] Fetching ${url} from network...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch 3D asset (${url}): ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let buffer: ArrayBuffer;

  if (response.body && totalBytes > 0) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.length;
        if (onProgress) {
          const percent = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
          onProgress(percent);
        }
      }
    }

    const fullArray = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullArray.set(chunk, offset);
      offset += chunk.length;
    }
    buffer = fullArray.buffer;
  } else {
    buffer = await response.arrayBuffer();
  }

  if (onProgress) onProgress(100);

  // 4. Save to IndexedDB and CacheStorage in the background
  saveToIndexedDB(url, buffer).catch((err) =>
    console.warn('[3D Cache] Failed to save buffer to IndexedDB:', err)
  );

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_STORAGE_NAME);
      const headers = new Headers();
      headers.set('Content-Type', 'model/gltf-binary');
      headers.set('Content-Length', buffer.byteLength.toString());
      cache.put(url, new Response(buffer.slice(0), { headers })).catch(() => {});
    } catch (e) {}
  }

  return buffer;
}
