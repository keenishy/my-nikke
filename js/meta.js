// 블라블라 게임 데이터 CDN (sg-tools-cdn.blablalink.com)
// 파일 경로는 블라블라 프론트엔드와 같은 방식으로 난독화됨:
//   폴더 하나마다 djb2 해시로 만든 "ab-12" 형태 이름, 파일명은 전체 경로의 md5
const CDN = "https://sg-tools-cdn.blablalink.com";
const PRIMES = [224737, 1000639, 2654435761, 2654435769, 1000621, 4294967291];

function djb2(str, seed) {
    let h = seed;
    for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) & 4294967295;
    return h;
}

function folderName(path, prime) {
    const r = ((djb2(path, prime) % prime) + prime) % prime;
    const letters = String.fromCharCode(97 + (Math.floor(r / 26) % 26), 97 + (r % 26));
    return `${letters}-${String(r % 99).padStart(2, "0")}`;
}

export function cdnUrl(path) {
    path = path.replace(/^\//, "");
    const parts = path.split("/");
    const ext = path.split(".").pop();
    const dirs = parts.slice(0, -1).map((_, i) => folderName(path, PRIMES[i]));
    return `${CDN}/${[...dirs, `${window.md5(path)}.${ext}`].join("/")}`;
}

export const portraitUrl = (resourceId, skin = 0) =>
    cdnUrl(`character/si/si_c${String(resourceId).padStart(3, "0")}_${String(skin).padStart(2, "0")}_s.webp`);

export const ELEMENT = { Fire: "작열", Water: "수냉", Wind: "풍압", Iron: "철갑", Electronic: "전격" };
export const ELEMENT_ICON = { Fire: "fire", Water: "water", Wind: "wind", Iron: "iron", Electronic: "electric" };
export const CLASS = { Attacker: "화력형", Defender: "방어형", Supporter: "지원형" };
export const BURST = { Step1: "Ⅰ", Step2: "Ⅱ", Step3: "Ⅲ", AllStep: "Ⅰ~Ⅲ", Free: "-" };
export const CORP = { ELYSION: "엘리시온", MISSILIS: "미실리스", TETRA: "테트라", PILGRIM: "필그림", ABNORMAL: "어브노멀" };
export const WEAPON = { AR: "돌격소총", SMG: "기관단총", SG: "산탄총", SR: "저격소총", RL: "로켓런처", MG: "기관총" };

// ---------- 아이콘 (이전 도감에서 쓰던 이미지) ----------
const ICON_FILE = {
    burst: { Step1: "1버", Step2: "2버", Step3: "3버" },
    corp: { ELYSION: "Elysion", MISSILIS: "Missilis", TETRA: "Tetra", PILGRIM: "Pilgrim", ABNORMAL: "Abnormal" },
    cls: { Attacker: "화력", Defender: "방어", Supporter: "지원" },
};
const iconImg = (file, title, invert) => (file ? `<img class="ico${invert ? " inv" : ""}" src="img/icon/${file}.png" alt="${title}" title="${title}">` : "");
export function nikkeIcons(m) {
    return [
        m.element ? `<img class="ico" src="img/${ELEMENT_ICON[m.element]}.png" alt="${ELEMENT[m.element]}" title="${ELEMENT[m.element]}">` : "",
        iconImg(WEAPON[m.weapon] ? m.weapon : "", WEAPON[m.weapon], true),
        iconImg(ICON_FILE.burst[m.burst], `버스트 ${BURST[m.burst]}`, true),
        iconImg(ICON_FILE.cls[m.cls], CLASS[m.cls], false),
        iconImg(ICON_FILE.corp[m.corp], CORP[m.corp], true),
    ].join("");
}

// 등급 색 (SSR 금색 / SR 보라 / R 파랑)
export const rareClass = (rare) => ({ SSR: "r-ssr", SR: "r-sr", R: "r-r" }[rare] || "");

// 오버로드 옵션 배지: 이전 도감과 같은 기준 — 최대치에 가까울수록 진하게
export const OPTION_BADGE = {
    IncElementDmg: ["우코", 116.64, "239, 68, 68"],
    StatAtk: ["공증", 58.52, "239, 68, 68"],
    StatAmmoLoad: ["장탄", 341.48, "217, 119, 6"],
    StatChargeTime: ["차속", 24.36, "37, 99, 235"],
    StatChargeDamage: ["차뎀", 58.52, "37, 99, 235"],
    StatCritical: ["크확", 28.28, "147, 51, 234"],
    StatCriticalDamage: ["크뎀", 81.44, "147, 51, 234"],
    StatAccuracyCircle: ["명중", 58.52, "16, 185, 129"],
    StatDef: ["방어", 58.52, "100, 116, 139"],
};
export function optionBadge(type, value, long = false) {
    const [short, max, rgb] = OPTION_BADGE[type] || [type, 100, "100, 116, 139"];
    const alpha = 0.15 + Math.min(value / max, 1) * 0.85;
    const label = long ? OPTION[type] || short : short;
    return `<span class="obadge" style="background:rgba(${rgb},${alpha.toFixed(2)})" title="${OPTION[type] || type} (최대 ${max}%)">${label} ${value.toFixed(2).replace(/\.?0+$/, "")}%</span>`;
}

// 소장품/애장품: 100xx01 = R, 100xx02 = SR (Lv 0~15), 200xxx = 전용 애장품 (lv 0/1/2 = 1/2/3단계)
export function favoriteInfo([tid, lv]) {
    if (!tid) return null;
    if (tid >= 200000) return { rare: "SSR", text: `애장품 ${lv + 1}단계` };
    const rare = tid % 100 === 2 ? "SR" : "R";
    return { rare, text: `${rare} ${lv}렙` };
}

// 리사이클 연구 (전초기지 recycle_room_researches 의 tid)
export const RECYCLE = [
    [1001, "일반"], [1101, "화력형"], [1102, "방어형"], [1103, "지원형"],
    [1201, "엘리시온"], [1202, "미실리스"], [1203, "테트라"], [1204, "필그림"], [1205, "어브노멀"],
];
export const RECYCLE_BY_CLASS = { Attacker: 1101, Defender: 1102, Supporter: 1103 };
export const RECYCLE_BY_CORP = { ELYSION: 1201, MISSILIS: 1202, TETRA: 1203, PILGRIM: 1204, ABNORMAL: 1205 };

// 니케 한 명의 상세 정보 (스쿼드·소개·성우 등) — 상세 창을 열 때만 받음
const roleCache = new Map();
export async function loadRoleData(resourceId) {
    if (!roleCache.has(resourceId)) roleCache.set(resourceId, getJson(`roledata/${resourceId}-v2-ko.json`).catch(() => null));
    return roleCache.get(resourceId);
}

// 영어 이름: 영어판 니케 목록에서 name_code → 이름
let englishNames = null;
export async function loadEnglishNames() {
    englishNames ||= getJson("character/en/nikke_list_en_v2.json")
        .then((list) => new Map(list.map((n) => [n.name_code, n.name_localkey?.name || ""])))
        .catch(() => new Map());
    return englishNames;
}

// 솔로 레이드 시즌 번호 → 보스 (블라블라 AI 덱 추천용 보스 목록, preset_group_id 100XX = 시즌 XX)
// element_id는 보스 자신의 속성이라 약점은 상성으로 바꿈 (수냉 보스 → 전격 약점)
const WEAKNESS_OF = { 100001: "Water", 200001: "Electronic", 300001: "Fire", 400001: "Iron", 500001: "Wind" };
let soloBosses = null;
export async function loadSoloRaidBosses() {
    soloBosses ||= getJson("boss/ai_lineup_boss.json")
        .then((list) => new Map(list.filter((b) => b.type_name === "SoloRaidCommon" && (b.wave_order ?? 1) === 1)
            .map((b) => [b.preset_group_id - 10000, { boss: b.wave_name?.ko || "", bossEn: b.wave_name?.en || "", element: WEAKNESS_OF[b.bosses?.[0]?.element_id?.[0]] || "" }])))
        .catch(() => new Map());
    return soloBosses;
}

// 오버로드 옵션 종류 (state_effects.function_type)
export const OPTION = {
    StatAtk: "공격력",
    IncElementDmg: "우월코드",
    StatAmmoLoad: "최대 장탄",
    StatCritical: "크리 확률",
    StatCriticalDamage: "크리 대미지",
    StatChargeTime: "차지 속도",
    StatChargeDamage: "차지 대미지",
    StatAccuracyCircle: "명중률",
    StatDef: "방어력",
};
export const OPTION_SHORT = {
    StatAtk: "공", IncElementDmg: "우", StatAmmoLoad: "장", StatCritical: "크확", StatCriticalDamage: "크뎀",
    StatChargeTime: "차속", StatChargeDamage: "차뎀", StatAccuracyCircle: "명중", StatDef: "방",
};

async function getJson(path) {
    const res = await fetch(cdnUrl(path));
    if (!res.ok) throw new Error(`${path} 불러오기 실패 (${res.status})`);
    return res.json();
}

// 니케 목록: name_code → 이름, 속성, 클래스 등
let nikkeMap = null;
export async function loadNikkeList() {
    if (nikkeMap) return nikkeMap;
    const list = await getJson("character/ko/nikke_list_v2.json");
    nikkeMap = new Map();
    for (const n of list) {
        if (!n.is_visible) continue;
        nikkeMap.set(n.name_code, {
            code: n.name_code,
            name: n.name_localkey?.name || `#${n.name_code}`,
            rare: n.original_rare,
            cls: n.class,
            burst: n.use_burst_skill,
            corp: n.corporation,
            element: n.element_id?.element?.element,
            weapon: n.shot_id?.element?.weapon_type,
            resource: n.resource_id,
            order: n.order,
        });
    }
    return nikkeMap;
}

// 큐브 이름은 큐브마다 파일이 따로 있어서 필요할 때 받아 localStorage에 기억
const CUBE_CACHE_KEY = "hub_cube_names";
const cubeNames = JSON.parse(localStorage.getItem(CUBE_CACHE_KEY) || "{}");
export async function loadCubeNames(ids) {
    const missing = [...new Set(ids)].filter((id) => id && !cubeNames[id]);
    await Promise.all(missing.map(async (id) => {
        try {
            const c = await getJson(`equip/ko/cube_${id}.json`);
            cubeNames[id] = c.name_localkey.replace(/ 큐브$/, "");
        } catch { cubeNames[id] = `큐브 ${id}`; }
    }));
    if (missing.length) localStorage.setItem(CUBE_CACHE_KEY, JSON.stringify(cubeNames));
    return cubeNames;
}
export const cubeName = (id) => (id ? cubeNames[id] || `큐브 ${id}` : "-");
