import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, writeBatch, FieldPath, deleteField } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./store.js";
import { ACCOUNTS } from "./config.js";

// 배너 문서 (gacha_banners/{id}):
// { name, element, type, period, start: "YYYY-MM-DD"|"", seq, legacy, edited,
//   results: { 계정: { "10": 칸, "20": 칸, ... } } }
// 매일 무료 1뽑 배너는 daily: true, end: 마지막 날(05시 기준)이고 칸 키가 날짜 ("2026-10-29": 칸, 단차 1회)
// 칸(10연차 1회): { d: [{ t: "pickup"|"spook"|"pilgrim"|"gold", n: 이름/장수, x: 중복 }], b: ""|"blank"|"blue"|"purple", m: 메모 }

export const DROP = {
    pickup: { label: "픽업", cls: "pickup" },
    spook: { label: "픽뚫", cls: "spook" },
    pilgrim: { label: "필그림", cls: "pilgrim" },
    gold: { label: "골티", cls: "gold" },
};
export const BLANK = { blank: "꽝", blue: "올블루", purple: "올퍼플" };

export const BANNER_TYPES = ["통상 출시", "통상 이격 출시", "한정 출시", "한정 이격 출시", "한정 복각", "한정 이격 복각", "콜라보 한정 출시", "콜라보 한정 복각", "필그림 픽업", "오버스펙 출시", "오버스펙 복각", "무료 모집", "매일 무료 1뽑"];

// 통계용 큰 분류
export function typeCategory(type = "") {
    if (/무료/.test(type)) return "무료";
    if (/복각/.test(type)) return "복각";
    if (/콜라보/.test(type)) return "콜라보";
    if (/필그림/.test(type)) return "필그림";
    if (/오버스펙/.test(type)) return "오버스펙";
    if (/한정/.test(type)) return "한정";
    return "통상";
}

// "모집 기간 : 2026년 7월 9일(목) ..." → "2026-07-09"
export function parseStart(text = "") {
    const m = text.match(/(20\d\d)\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

// 모집 기간 원문의 "~" 뒤 날짜 = 끝나는 날. 05시 전에 끝나면 그 전날이 마지막 뽑기 날
export function parseEnd(text = "") {
    const m = text.split("~")[1]?.match(/(20\d\d)\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})[^\d]*(?:(\d{1,2}):\d\d)?/);
    if (!m) return "";
    const d = new Date(Date.UTC(m[1], m[2] - 1, m[3]));
    if (m[4] != null && Number(m[4]) < 5) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

// 시작일~끝날(오늘 넘지 않게) 날짜 목록
export function dailyDates(b, today) {
    const out = [];
    if (!b.start) return out;
    const last = b.end && b.end < today ? b.end : today;
    for (let d = new Date(`${b.start}T00:00:00Z`); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
    return out;
}

export const isActiveDaily = (b, today) => b.daily && b.start && b.start <= today && (!b.end || today <= b.end);

// 계정별 요약: 총 연차 = 기록된 가장 큰 연차 번호 (기존 트래커와 같은 방식)
// 매일 무료 1뽑은 기록한 날 수가 곧 뽑은 횟수, 첫 픽업은 몇 번째 뽑기였는지
export function accountSummary(slots = {}, daily = false) {
    const s = { pulls: 0, pickup: 0, spook: 0, pilgrim: 0, gold: 0, firstPickup: 0 };
    const keys = Object.keys(slots).sort();
    for (const [key, slot] of Object.entries(slots)) {
        const n = daily ? keys.indexOf(key) + 1 : Number(key);
        s.pulls = Math.max(s.pulls, n);
        for (const d of slot.d || []) {
            if (d.t === "gold") s.gold += parseInt(d.n) || 1;
            else s[d.t]++;
            if (d.t === "pickup" && (!s.firstPickup || n < s.firstPickup)) s.firstPickup = n;
        }
    }
    return s;
}

// 한 번 읽은 목록은 저장·삭제하기 전까지 다시 씀 (Firebase 읽기 한도 절약)
let bannersCache = null;
export function loadBanners() {
    bannersCache ||= getDocs(collection(db, "gacha_banners")).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        .catch((e) => { bannersCache = null; throw e; });
    return bannersCache;
}

export async function saveBannerInfo(id, info) {
    bannersCache = null;
    await setDoc(doc(db, "gacha_banners", id), { ...info, edited: true }, { merge: true });
}

export async function saveSlot(id, account, key, slot) {
    bannersCache = null;
    const empty = !slot.d.length && !slot.b && !slot.m.trim();
    await updateDoc(doc(db, "gacha_banners", id), new FieldPath("results", account, key), empty ? deleteField() : slot, "edited", true);
}

// 여러 칸을 한 번에 저장 (엑셀 색 다시 분류용). rows: [{ id, account, key, slot }]
export async function saveSlots(rows, onProgress) {
    bannersCache = null;
    for (let i = 0; i < rows.length; i += 400) {
        const batch = writeBatch(db);
        for (const r of rows.slice(i, i + 400)) batch.update(doc(db, "gacha_banners", r.id), new FieldPath("results", r.account, r.key), r.slot, "edited", true);
        await batch.commit();
        onProgress?.(Math.min(i + 400, rows.length));
    }
}

export const deleteBanner = (id) => { bannersCache = null; return deleteDoc(doc(db, "gacha_banners", id)); };

export function newBannerId() {
    return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- 기존 가챠 트래커(gacha_records) 가져오기 ----------
const ELEMENT_FROM_KO = { 작열: "Fire", 수냉: "Water", 풍압: "Wind", 철갑: "Iron", 전격: "Electronic" };
const legacyAccount = (a) => {
    const name = String(a).replace(/^\d+\s*/, "").trim();
    return name === "키피" ? "케니피" : name;
};

function convertSlot(p) {
    const d = [];
    if (p.details?.length) {
        for (const x of p.details) d.push({ t: x.type === "goldTicket" ? "gold" : x.type, n: x.name || "", x: !!x.isDust });
    } else {
        for (const t of ["pickup", "spook", "pilgrim"]) for (let i = 0; i < (p[t] || 0); i++) d.push({ t, n: "", x: false });
        if (p.goldTicket) d.push({ t: "gold", n: `${p.goldTicket}장`, x: false });
    }
    const b = p.isAllBlue ? "blue" : p.isAllPurple ? "purple" : p.isBlank || /^x$/i.test(p.memo || "") ? "blank" : "";
    return { d, b, m: /^x$/i.test(p.memo || "") ? "" : (p.memo || "") };
}

// 같은 배너는 계정마다 문서가 따로 있으므로 묶어서 하나로 만듦
// 기간이 있으면 이름+기간, 없으면 이름+출시 타입으로 묶음
export async function buildLegacyBanners(releaseDates) {
    const snap = await getDocs(collection(db, "gacha_records"));
    const groups = new Map();
    let skipped = 0;
    snap.docs.forEach((d, i) => {
        const r = d.data();
        const account = legacyAccount(r.account);
        if (!ACCOUNTS.includes(account)) { skipped++; return; }
        const b = r.bannerInfo || {};
        const name = (b.nameKor || "").trim();
        const period = (b.dateStart || "").trim();
        const key = `${name}|${period ? `D:${period}` : `T:${(b.bannerType || "").replace(/\s/g, "")}`}`;
        if (!groups.has(key)) groups.set(key, { key, name, period, types: [], elements: [], docs: [], seq: i });
        const g = groups.get(key);
        g.types.push(b.bannerType || "");
        g.elements.push(b.attribute || "");
        g.docs.push({ account, pulls: r.pullRecords || {} });
    });

    // 계정 하나짜리 조각은 같은 이름의 다른 묶음과 계정이 안 겹치면 합침 (일부 계정만 출시 타입을 고친 경우)
    const list = [...groups.values()];
    for (const g of list.filter((x) => x.docs.length === 1)) {
        const acc = g.docs[0].account;
        const target = list.find((o) => o !== g && o.docs.length > 1 && o.name === g.name && !o.docs.some((d) => d.account === acc));
        if (target) { target.docs.push(...g.docs); target.period ||= g.period; g.merged = true; }
    }

    const mostCommon = (arr) => Object.entries(arr.filter(Boolean).reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const banners = list.filter((g) => !g.merged).map((g) => {
        const type = mostCommon(g.types);
        let start = parseStart(g.period);
        if (!start && !/복각/.test(type)) start = releaseDates.get(g.name.replace(/\s/g, "")) || "";
        const results = {};
        for (const { account, pulls } of g.docs) {
            results[account] ||= {};
            for (const [k, p] of Object.entries(pulls)) results[account][k] = convertSlot(p);
        }
        return {
            id: `legacy-${window.md5(g.key).slice(0, 12)}`,
            name: g.name, element: ELEMENT_FROM_KO[mostCommon(g.elements)] || "", type, period: g.period, start,
            seq: g.seq, legacy: true, edited: false, results,
        };
    });
    return { banners, skipped };
}

// 허브에서 고친 배너(edited)는 건드리지 않고 나머지만 덮어씀
export async function importLegacy(banners, existing) {
    const edited = new Set(existing.filter((b) => b.edited).map((b) => b.id));
    const todo = banners.filter((b) => !edited.has(b.id));
    bannersCache = null;
    for (let i = 0; i < todo.length; i += 400) {
        const batch = writeBatch(db);
        for (const { id, ...b } of todo.slice(i, i + 400)) batch.set(doc(db, "gacha_banners", id), b);
        await batch.commit();
    }
    return { written: todo.length, keptEdited: banners.length - todo.length };
}

export async function loadReleaseDates() {
    const map = new Map();
    try {
        const text = await (await fetch("data/release-dates.csv")).text();
        for (const line of text.split(/\r?\n/).slice(1)) {
            const [d, name] = line.split(",");
            const m = d?.match(/^(\d\d)\.(\d\d)\.(\d\d)$/);
            // (복각) 줄은 출시일이 아니므로 건너뜀, 같은 이름이 여러 번 나오면 가장 이른 날짜
            if (!m || !name || /\(복각\)/.test(name)) continue;
            const key = name.replace(/\(배포\)/g, "").replace(/\s/g, "");
            const date = `20${m[1]}-${m[2]}-${m[3]}`;
            if (!map.has(key) || date < map.get(key)) map.set(key, date);
        }
    } catch {}
    return map;
}
