// A small fake of the browser's IndexedDB: just enough for js/outbox-core.js (one object store keyed by "id").
// Shared by the store tests, the service worker tests and the app tests. Pass the SAME fake to the page and to
// the worker to prove they see the same reports, like two real contexts on one origin.
//
// Failure switches:
//   openError   the browser refuses to open the database (private window, storage blocked)
//   blocked     another tab holds an old version open
//   writeError  every write fails (device full)

export function fakeIndexedDB({ openError = null, blocked = false, writeError = null } = {}) {
  const databases = new Map();
  const later = (fn) => setTimeout(fn, 0);

  function transaction(store, mode) {
    const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
    const request = (work) => {
      const req = { result: undefined, error: null };
      later(() => {
        if (writeError && mode === 'readwrite') {
          tx.error = writeError;
          if (tx.onabort) tx.onabort();
          return;
        }
        req.result = work();
        if (tx.oncomplete) tx.oncomplete();
      });
      return req;
    };
    tx.objectStore = () => ({
      put: (record) => request(() => { store.rows.set(record[store.keyPath], structuredClone(record)); return record[store.keyPath]; }),
      get: (id) => request(() => { const r = store.rows.get(id); return r ? structuredClone(r) : undefined; }),
      getAll: () => request(() => [...store.rows.values()].map((r) => structuredClone(r))),
      delete: (id) => request(() => { store.rows.delete(id); }),
    });
    return tx;
  }

  return {
    databases,
    open(name, version) {
      const request = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        if (openError) {
          request.error = openError;
          if (request.onerror) request.onerror();
          return;
        }
        if (blocked) {
          if (request.onblocked) request.onblocked();
          return;
        }
        let data = databases.get(name);
        const isNew = !data;
        if (isNew) {
          data = { version, stores: new Map() };
          databases.set(name, data);
        }
        request.result = {
          objectStoreNames: { contains: (n) => data.stores.has(n) },
          createObjectStore: (n, { keyPath }) => data.stores.set(n, { keyPath, rows: new Map() }),
          transaction: (n, mode) => {
            if (!data.stores.has(n)) throw new Error(`NotFoundError: no object store "${n}"`);
            return transaction(data.stores.get(n), mode);
          },
          close() {},
          onversionchange: null,
        };
        if (isNew && request.onupgradeneeded) request.onupgradeneeded();
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };
}
