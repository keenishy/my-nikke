import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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
