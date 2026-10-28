import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDocs, setDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { FIREBASE_CONFIG } from "./config.js";

export const db = getFirestore(initializeApp(FIREBASE_CONFIG));
const LOCAL_KEY = "hub_roster";

// 계정 문서 형식: { account, fetched_at, data: JSON 문자열 }
// (Firestore는 배열 안의 배열을 못 넣어서 정리된 데이터를 통째로 문자열로 저장)
export async function loadRosters() {
    let local = {};
    try { local = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}"); } catch {}
    try {
        const snap = await getDocs(collection(db, "roster"));
        const cloud = {};
        snap.forEach((d) => { cloud[d.id] = JSON.parse(d.data().data); });
        // 계정마다 더 최근에 받은 쪽을 사용
        for (const [acc, r] of Object.entries(local)) {
            if (!cloud[acc] || cloud[acc].fetched_at < r.fetched_at) cloud[acc] = r;
        }
        localStorage.setItem(LOCAL_KEY, JSON.stringify(cloud));
        return { rosters: cloud, cloudOk: true };
    } catch (e) {
        console.warn("Firebase 불러오기 실패, 이 브라우저에 저장된 데이터만 사용", e);
        return { rosters: local, cloudOk: false };
    }
}

export async function saveRoster(roster) {
    const all = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
    all[roster.account] = roster;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
    await setDoc(doc(db, "roster", roster.account), {
        account: roster.account,
        fetched_at: roster.fetched_at,
        data: JSON.stringify(roster),
    });
}
