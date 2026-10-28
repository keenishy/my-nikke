import { collection, getDocs, doc, writeBatch, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./store.js";

// 허브 Firebase의 모든 기록을 JSON 파일 하나로 내려받음 (문서 수만큼 읽기 한도를 쓰므로 가끔만)
// gacha_records는 예전 가챠 트래커 원본이라 허브 기록(gacha_banners)과 따로 넣어 둠
const COLLECTIONS = ["roster", "gacha_banners", "gacha_records", "raids", "intercept", "nikke_notes", "union_info", "union_raids", "union_members", "unions"];

export async function downloadBackup(onProgress = () => {}) {
    const out = { app: "nikke-hub", saved_at: new Date().toISOString(), collections: {} };
    let total = 0;
    for (const name of COLLECTIONS) {
        onProgress(`${name} 읽는 중…`);
        const snap = await getDocs(collection(db, name));
        out.collections[name] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
        total += snap.size;
    }
    const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nikke-hub-backup-${out.saved_at.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return total;
}

// 백업 파일 → Firebase에 다시 씀. 백업에 있는 문서만 덮어쓰고, 백업 뒤에 새로 생긴 문서는 그대로 둠
// (Firestore 날짜 값은 JSON에서 {seconds, nanoseconds}로 저장되므로 다시 날짜 값으로 바꿈)
const revive = (v) => {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === "object") {
        const keys = Object.keys(v);
        if (keys.length === 2 && typeof v.seconds === "number" && typeof v.nanoseconds === "number") return new Timestamp(v.seconds, v.nanoseconds);
        return Object.fromEntries(keys.map((k) => [k, revive(v[k])]));
    }
    return v;
};

export async function readBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error("JSON 파일이 아닙니다"); }
    if (data?.app !== "nikke-hub" || !data.collections) throw new Error("니케 허브 백업 파일이 아닙니다");
    return data;
}

export async function restoreBackup(data, onProgress = () => {}) {
    const docs = Object.entries(data.collections).flatMap(([name, list]) => Object.entries(list).map(([id, d]) => [name, id, d]));
    for (let i = 0; i < docs.length; i += 400) {
        onProgress(`복원 중 ${Math.min(i + 400, docs.length).toLocaleString()} / ${docs.length.toLocaleString()}`);
        const batch = writeBatch(db);
        for (const [name, id, d] of docs.slice(i, i + 400)) batch.set(doc(db, name, id), revive(d));
        await batch.commit();
    }
    return docs.length;
}
