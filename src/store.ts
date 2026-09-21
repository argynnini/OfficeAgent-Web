/**
 * 選んだ .acs を IndexedDB に保存する。
 * .acs は再配布できないのでリポジトリには含めず、ユーザーが 1 回選べば次回から自動で読み込む。
 */
const DB_NAME = "officeagent-web";
const STORE = "files";
const KEY = "character";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCharacter(name: string, data: ArrayBuffer): Promise<void> {
  await run("readwrite", (s) => s.put({ name, data }, KEY));
}

export async function loadCharacter(): Promise<{ name: string; data: ArrayBuffer } | undefined> {
  return run("readonly", (s) => s.get(KEY));
}
