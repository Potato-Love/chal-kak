// Photo Guide - IndexedDB persistence for custom References v5.2
const DB_NAME="PhotoGuideCustomReferences";
const DB_VERSION=1;
const STORE="references";

function openDb() {
    return new Promise((resolve,reject)=>{
        if (!("indexedDB" in globalThis)) {
            reject(new Error("IndexedDB unavailable"));
            return;
        }
        const request=indexedDB.open(DB_NAME,DB_VERSION);
        request.onupgradeneeded=()=>{
            const db=request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store=db.createObjectStore(STORE,{keyPath:"id"});
                store.createIndex("createdAt","createdAt");
            }
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error ?? new Error("IndexedDB open failed"));
    });
}

function txRequest(mode,work) {
    return openDb().then(db=>new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,mode);
        const store=tx.objectStore(STORE);
        let result;
        try { result=work(store); } catch (e) { db.close(); reject(e); return; }
        tx.oncomplete=()=>{ db.close(); resolve(result); };
        tx.onerror=()=>{ db.close(); reject(tx.error ?? new Error("IndexedDB transaction failed")); };
        tx.onabort=()=>{ db.close(); reject(tx.error ?? new Error("IndexedDB transaction aborted")); };
    }));
}

export async function listCustomReferences() {
    const db=await openDb();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,"readonly");
        const req=tx.objectStore(STORE).getAll();
        req.onsuccess=()=>resolve((req.result ?? []).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))));
        req.onerror=()=>reject(req.error ?? new Error("Custom Reference load failed"));
        tx.oncomplete=()=>db.close();
    });
}

export async function saveCustomReference(record) {
    if (!record?.id) throw new Error("Custom Reference id is required");
    await txRequest("readwrite",store=>store.put(record));
    return record;
}

export async function deleteCustomReference(id) {
    await txRequest("readwrite",store=>store.delete(id));
}
