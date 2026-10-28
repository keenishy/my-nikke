import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./store.js";

// 레이드 문서 (raids/{id}):
// { kind: "solo"|"coop", season: 숫자|null, boss, bossEn, element, start: "YYYY-MM-DD", end, deck, note, legacy, edited,
//   results: { 계정: { runs: [{ score: 숫자, pct: 숫자|null, deck: [name_code ×5] }], memo } } }

export const KIND = { solo: "솔로 레이드", coop: "협동 작전" };

// 한 번 읽은 목록은 저장·삭제하기 전까지 다시 씀 (Firebase 읽기 한도 절약)
let raidsCache = null;
export function loadRaids() {
    raidsCache ||= getDocs(collection(db, "raids")).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        .catch((e) => { raidsCache = null; throw e; });
    return raidsCache;
}

export const saveRaid = ({ id, ...raid }) => { raidsCache = null; return setDoc(doc(db, "raids", id), { ...raid, edited: true }); };
export const deleteRaid = (id) => { raidsCache = null; return deleteDoc(doc(db, "raids", id)); };
export const newRaidId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 한 계정의 최고 기록 (점수는 가장 높은 것, 상위 %는 가장 낮은 것)
export function best(result) {
    const runs = (result?.runs || []).filter((r) => r.score || r.pct != null);
    if (!runs.length) return null;
    const top = runs.reduce((m, r) => ((r.score || 0) > (m.score || 0) ? r : m), runs[0]);
    const pcts = runs.map((r) => r.pct).filter((p) => p != null);
    return { score: top.score || 0, pct: pcts.length ? Math.min(...pcts) : null, runs: runs.length, deck: top.deck || [] };
}

export const fmtScore = (n) => (!n ? "-" : n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n.toLocaleString());
export const parseScore = (s) => Number(String(s ?? "").replace(/[^0-9]/g, "")) || 0;
export const parsePct = (s) => { const v = parseFloat(String(s ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(v) ? v : null; };

// ---------- 기존 레이드 기록부(nikke-ranking 프로젝트) 가져오기 ----------
const LEGACY_CONFIG = {
    apiKey: "AIzaSyCOGu3WVpkRpDBTmSllRUMf24vD7sPULWY",
    authDomain: "nikke-ranking.firebaseapp.com",
    projectId: "nikke-ranking",
};
const LEGACY_ACC = { kenny: "케니", kinishi: "키니시", kini: "키니", kichi: "키치", kishi: "키시", kiki: "키키", kipi: "케니피" };
const ELEMENT_FROM_KO = { 작열: "Fire", 수냉: "Water", 풍압: "Wind", 철갑: "Iron", 전격: "Electronic" };

// "26.08.20.목.12:00<br>26.08.27..." / "26.10.09 ~ 26.10.11" → 시작·끝 날짜
function parseDates(text = "") {
    const all = [...String(text).matchAll(/(?<![\d.])(\d{2})\.(\d{1,2})\.(\d{1,2})(?![\d])/g)].map((m) => `20${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
    return { start: all[0] || "", end: all[1] || "" };
}

function convertLegacy(kind, r) {
    let season = String(r.season || "");
    let boss = r.boss || "";
    if (season.includes("<br>")) { const [s, b] = season.split("<br>"); season = s; boss ||= b; }
    const seasonNo = parseInt(season.match(/\d+/)?.[0]);
    let { start, end } = parseDates(r.date);
    if (!start && boss === "지즈") start = "2026-01-30"; // 기존 기록부와 같은 보정 (날짜 없이 저장된 지즈)
    const results = {};
    for (const [key, acc] of Object.entries(LEGACY_ACC)) {
        const [scores = "", pcts = "", memo = ""] = r[key] || [];
        const sList = String(scores).split(/<br\s*\/?>|\n/i);
        const pList = String(pcts).split(/<br\s*\/?>|\n/i);
        const runs = [];
        for (let i = 0; i < Math.max(sList.length, pList.length); i++) {
            const run = { score: parseScore(sList[i]), pct: parsePct(pList[i]) };
            if (run.score || run.pct != null) runs.push(run);
        }
        if (runs.length || memo) results[acc] = { runs, memo: memo || "" };
    }
    return {
        id: `legacy-${kind}-${r.id}`,
        kind, season: Number.isFinite(seasonNo) ? seasonNo : null, boss: boss.trim(),
        bossEn: (kind === "solo" ? r.english : "") || "", element: ELEMENT_FROM_KO[r.weakness] || "",
        start, end, deck: (kind === "coop" ? r.deck : "") || "", note: r.note || "",
        dateText: String(r.date || "").replace(/<br\s*\/?>/gi, " ~ "),
        legacy: true, edited: false, results,
    };
}

export async function buildLegacyRaids() {
    const app = getApps().find((a) => a.name === "nikke-ranking") || initializeApp(LEGACY_CONFIG, "nikke-ranking");
    const legacyDb = getFirestore(app);
    const out = [];
    for (const kind of ["solo", "coop"]) {
        const snap = await getDocs(collection(legacyDb, kind));
        snap.forEach((d) => out.push(convertLegacy(kind, { id: d.id, ...d.data() })));
    }
    return out;
}

// 허브에서 고친 기록(edited)은 덮어쓰지 않음
export async function importLegacyRaids(raids, existing) {
    const edited = new Set(existing.filter((r) => r.edited).map((r) => r.id));
    const todo = raids.filter((r) => !edited.has(r.id));
    raidsCache = null;
    const batch = writeBatch(db);
    for (const { id, ...r } of todo) batch.set(doc(db, "raids", id), r);
    await batch.commit();
    return { written: todo.length, keptEdited: raids.length - todo.length };
}
