import { WORKER_URL } from "./config.js";

const KEY_STORAGE = "hub_access_key";
export const getAccessKey = () => localStorage.getItem(KEY_STORAGE) || "";
export const setAccessKey = (k) => localStorage.setItem(KEY_STORAGE, k.trim());

async function callWorker(path, params = {}) {
    const url = new URL(path, WORKER_URL);
    url.search = new URLSearchParams({ key: getAccessKey(), ...params });
    const res = await fetch(url);
    const body = await res.json().catch(() => ({ error: `응답을 읽지 못했습니다 (${res.status})` }));
    if (!res.ok || body.error) throw new Error(body.error || `요청 실패 (${res.status})`);
    return body;
}

export const checkWorker = () => callWorker("/");
export const fetchUnions = () => callWorker("/unions");
export const fetchUnionMembers = (guild) => callWorker("/union-members", { guild });
export const fetchUnionRaid = (guild, season, live = false) => callWorker("/union-raid", { guild, season, ...(live ? { live: "1" } : {}) });

const PARTS = ["head", "torso", "arm", "leg"];

// Worker가 돌려준 블라블라 원본 → 도감에서 쓰는 작은 형태로 정리
function normalize(raw) {
    const levels = new Map(raw.characters.data.characters.map((c) => [c.name_code, c]));
    const opts = {};
    const nikkes = [];
    for (const chunk of raw.details) {
        for (const se of chunk.data.state_effects || []) {
            const f = se.function_details?.[0];
            if (f) opts[se.id] = [f.function_type, f.function_value];
        }
        for (const d of chunk.data.character_details || []) {
            const base = levels.get(d.name_code) || {};
            nikkes.push({
                c: d.name_code,
                g: d.grade,
                k: d.core,
                lv: base.lv ?? d.lv,
                cp: base.combat ?? d.combat,
                s: [d.skill1_lv, d.skill2_lv, d.ulti_skill_lv],
                a: d.attractive_lv,
                cube: [d.harmony_cube_tid, d.harmony_cube_lv],
                acube: [d.arena_harmony_cube_tid, d.arena_harmony_cube_lv],
                fav: [d.favorite_item_tid, d.favorite_item_lv],
                eq: PARTS.map((p) => [d[`${p}_equip_tier`], d[`${p}_equip_lv`],
                    [1, 2, 3].map((i) => d[`${p}_equip_option${i}_id`]).filter(Boolean)]),
            });
        }
    }
    // 실제로 쓰인 옵션만 남김
    const used = new Set(nikkes.flatMap((n) => n.eq.flatMap((e) => e[2])));
    for (const id of Object.keys(opts)) if (!used.has(Number(id))) delete opts[id];

    return {
        account: raw.account,
        fetched_at: raw.fetched_at,
        synchro: raw.outpost?.data?.outpost_info?.synchro_level ?? null,
        // 리사이클 연구 레벨 { tid: lv } (1001 일반, 110x 클래스, 120x 기업)
        recycle: Object.fromEntries((raw.outpost?.data?.outpost_info?.recycle_room_researches || []).map((r) => [r.tid, r.lv])),
        nikkes,
        opts,
    };
}

export async function fetchAccount(account) {
    return normalize(await callWorker("/sync", { acc: account }));
}
