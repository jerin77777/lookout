/**
 * Centralized Three.js Singleton Loader.
 * Prevents multiple script injections, duplicate Three.js warnings, and race conditions.
 */

let threeLoadingPromise: Promise<any> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return resolve();

    // Check if script is already present
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement;
    if (existing) {
      if ((existing as any).__loaded) {
        return resolve();
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (e) => reject(e));
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => {
      (script as any).__loaded = true;
      resolve();
    };
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

/**
 * Loads Three.js and essential loaders sequentially (Three.js -> GLTFLoader -> DRACOLoader -> FBXLoader)
 */
export function loadThreeBundle(): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null);

  const win = window as any;
  if (win.THREE && win.THREE.GLTFLoader && win.THREE.DRACOLoader && win.THREE.FBXLoader) {
    return Promise.resolve(win.THREE);
  }

  if (threeLoadingPromise) {
    return threeLoadingPromise;
  }

  threeLoadingPromise = (async () => {
    try {
      // 1. Three.js core
      if (!win.THREE) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');
      }

      // 2. GLTFLoader
      if (win.THREE && !win.THREE.GLTFLoader) {
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js');
      }

      // 3. DRACOLoader
      if (win.THREE && !win.THREE.DRACOLoader) {
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js');
      }

      // 4. fflate (required for FBXLoader)
      if (!win.fflate) {
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js');
        } catch (e) {
          console.warn('[ThreeLoader] fflate load optional fallback:', e);
        }
      }

      // 5. FBXLoader
      if (win.THREE && !win.THREE.FBXLoader) {
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/FBXLoader.js');
        } catch (e) {
          console.warn('[ThreeLoader] FBXLoader failed to load:', e);
        }
      }

      return win.THREE;
    } catch (err) {
      console.error('[ThreeLoader] Failed to load Three.js bundle:', err);
      threeLoadingPromise = null;
      throw err;
    }
  })();

  return threeLoadingPromise;
}
