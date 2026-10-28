import { collection, getDocs, doc, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./store.js";
import { ACCOUNTS } from "./config.js";

// 특수 요격전 문서 (intercept/{YYYY-MM-DD}):
// { date, edited, legacy, results: { 계정: { boss, fb: 풀버데이, skip: 미참여, memo,
//     runs: [{ stage: 9, skip, mod: 일반 모듈 수, c: 일반 장비 기업, r: 일반 장비 부위, fmod: 풀버 모듈 수, fc, fr }] ×3 } } }
// 날짜·계정 단위로 저장해서 다른 계정 기록을 덮어쓰지 않음

export const BOSSES = ["크라켄", "울트라", "인디빌", "미러 컨테이너", "하베스터"];
export const CORPS = ["엘리시온", "미실리스", "테트라", "필그림", "앱노멀"];
export const ROLES = ["화력", "방어", "지원"];
export const PATCH_DATE = "2026-07-23";

// 9단계 일반 모듈 0~3개 공식 확률 (패치 전 / 후)
export const OFFICIAL = { pre: [42.0, 40.655, 16.764, 0.58], post: [31.0, 48.366, 19.943, 0.69] };

export const emptyRun = () => ({ stage: 9, skip: false, mod: 0, c: "", r: "", fmod: 0, fc: "", fr: "" });
export const emptyResult = (boss = "크라켄", fb = false, count = 3) => ({ boss, fb, skip: false, memo: "", runs: Array.from({ length: count }, emptyRun) });

// 4주년 업데이트(2026-10-29) 싱크로 부스트: 싱크로 디바이스 400·600레벨마다 요격 횟수 +1 (영구)
export const SYNCHRO_BOOST_DATE = "2026-10-29";
export function runCountFor(synchro, date) {
    if (date < SYNCHRO_BOOST_DATE || !synchro) return 3;
    return 3 + (synchro >= 400 ? 1 : 0) + (synchro >= 600 ? 1 : 0);
}

// 니케 하루 초기화는 한국 시간 05:00 → 그 전까지는 전날 기록
export function gameDate(now = Date.now()) {
    return new Date(now + (9 - 5) * 3600 * 1000).toISOString().slice(0, 10);
}

// 기존 사이트와 같은 기댓값: 단계별 상자 확률 × 1.309037, 풀버데이는 2배
function boxRate(stage, date) {
    const post = date >= PATCH_DATE;
    if (stage === 9) return post ? 0.69 : 0.58;
    if (stage === 8) return post ? 0.67 : 0.58;
    if (stage === 7) return post ? 0.65 : 0.58;
    return 0.5;
}
export function expectedOf(res, date) {
    if (!res || res.skip) return 0;
    return res.runs.reduce((sum, run) => run.skip ? sum : sum + boxRate(run.stage, date) * 1.309037 * (res.fb ? 2 : 1), 0);
}
export function actualOf(res) {
    if (!res || res.skip) return 0;
    return res.runs.reduce((sum, run) => run.skip ? sum : sum + run.mod + (res.fb ? run.fmod : 0), 0);
}
// 기존 분포 통계처럼 메모에 "안했/못함/까먹"이 있으면 그날은 분포에서 뺌
export const excludedFromDist = (res) => res.skip || /안했|못함|까먹/.test(res.memo || "");

export async function loadDays() {
    const snap = await getDocs(collection(db, "intercept"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 한 날짜의 여러 계정 기록을 한 번에 저장 (merge라서 다른 계정 칸은 그대로)
export async function saveDay(date, results) {
    await setDoc(doc(db, "intercept", date), { date, edited: true, results }, { merge: true });
}

// ---------- 기존 특특요 사이트(실시간 DB) 가져오기 ----------
export const LEGACY_URL_KEY = "hub_intercept_legacy_url";
const num = (v) => Number(v) || 0;
const bossName = (b) => (b === "미컨" ? "미러 컨테이너" : b || "크라켄");

function convertRecord(r) {
    return {
        boss: bossName(r.boss),
        fb: !!r.isFullburst,
        skip: !!r.isSkipped,
        memo: r.memo || "",
        runs: (r.runs || []).slice(0, 3).map((x) => ({
            stage: num(String(x.stage).replace(/[^0-9]/g, "")) || 9,
            skip: !!x.isSkipped,
            mod: num(x.basic), c: x.nComp || "", r: x.nRole || "",
            fmod: num(x.fb), fc: x.fbComp || "", fr: x.fbRole || "",
        })),
    };
}

export async function buildLegacyDays(url) {
    const res = await fetch(`${url}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`기존 데이터를 읽지 못했습니다 (${res.status})`);
    const data = await res.json();
    const records = (Array.isArray(data?.records) ? data.records : Object.values(data?.records || {})).filter(Boolean);
    const days = new Map();
    let skipped = 0;
    for (const r of records) {
        if (!r.date || !ACCOUNTS.includes(r.account)) { skipped++; continue; }
        if (!days.has(r.date)) days.set(r.date, { date: r.date, legacy: true, edited: false, results: {} });
        days.get(r.date).results[r.account] = convertRecord(r);
    }
    return { days: [...days.values()], records: records.length, skipped };
}

// 허브에서 고친 날짜(edited)는 덮어쓰지 않음
export async function importLegacyDays(days, existing) {
    const edited = new Set(existing.filter((d) => d.edited).map((d) => d.id));
    const todo = days.filter((d) => !edited.has(d.date));
    for (let i = 0; i < todo.length; i += 400) {
        const batch = writeBatch(db);
        for (const d of todo.slice(i, i + 400)) batch.set(doc(db, "intercept", d.date), d);
        await batch.commit();
    }
    return { written: todo.length, keptEdited: days.length - todo.length };
}
