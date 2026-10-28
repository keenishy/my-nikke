import { collection, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./store.js";
import { ACCOUNTS } from "./config.js";
import { cdnUrl, loadNikkeList, portraitUrl, ELEMENT, ELEMENT_ICON } from "./meta.js";
import { fetchUnions, fetchUnionRaid, fetchUnionMembers, getAccessKey } from "./sync.js";

// 저장 위치 (허브 Firebase)
//   union_info/latest          : 계정별 소속 유니온 + 유니온 공개 정보 (블라블라에서 받은 그대로)
//   union_raids/{유니온}_{시즌} : 시즌 레이드 기록을 정리한 것 (블라블라가 옛 시즌을 지워도 남도록 저장)
//   unions/{유니온}             : 직접 쓰는 메모
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ELEMENT_BY_ID = { 100001: "Fire", 200001: "Water", 300001: "Wind", 400001: "Electronic", 500001: "Iron" };
const DIFF = { 1: "노말", 2: "하드" };

const u = {
    info: null,          // { members: {계정: 유니온id}, unions: {id: {...}}, fetched_at }
    current: localStorage.getItem("hub_union_guild") || "",
    seasons: [],         // raid_list.json
    season: "",
    raids: {},           // "유니온_시즌" → 정리된 기록
    memos: {},
    idMap: null,         // 덱 캐릭터 id → name_code
    meta: null,
    openMember: null,
    members: {},         // 유니온 → { fetched_at, list: [{id, nick, level, synchro}], firstSeen: {id: 날짜} }
    diffTab: "all",
    sort: localStorage.getItem("hub_union_sort") || "join",
};

const guildIds = () => {
    const order = [];
    for (const a of ACCOUNTS) { const g = u.info?.members?.[a]; if (g && !order.includes(g)) order.push(g); }
    return order;
};
const accountsOf = (g) => ACCOUNTS.filter((a) => u.info?.members?.[a] === g);
const fmtDmg = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n.toLocaleString());
const seasonLabel = (s) => `${s.season_start_date.slice(2, 10).replace(/-/g, ".")} ~ ${s.season_end_date.slice(5, 10).replace("-", ".")}`;
const isLive = (s) => { const now = Date.now(); return now >= s.start_ts * 1000 && now <= (s.caculate_ts + 86400) * 1000; };

// 블라블라 원본 → 저장용으로 정리
function normalizeRaid(r) {
    const attacks = (r.raid?.data?.participate_data || []).map((p) => ({
        openid: p.openid, nick: p.nickname, day: p.day, boss: p.name_localvalues?.ko || p.boss_id,
        element: ELEMENT_BY_ID[p.element_id?.[0]] || "", diff: p.difficulty, level: p.level, step: p.step,
        damage: Number(p.total_damage) || 0, final: !!p.is_final_hit, squad: (p.squad || []).map((s) => s.tid),
    }));
    const lv = r.level?.data?.level_info?.[0];
    const bosses = (lv?.boss_info || []).map((b) => ({
        name: b.name_localvalues?.ko || b.boss_id, element: ELEMENT_BY_ID[b.element_id?.[0]] || "",
        hp: Number(b.current_hp) || 0, max: Number(b.max_hp) || 0,
    }));
    return { guild: r.guild, season: r.season, fetched_at: r.fetched_at, diff: lv?.difficulty ?? null, level: lv?.level ?? null, bosses, attacks };
}

// ---------- 화면 ----------
function render() {
    const ids = guildIds();
    if (!u.info) {
        $("#union-subtabs").innerHTML = "";
        $("#union-view").innerHTML = `<div class="union-card"><p>블라블라에서 유니온 정보를 아직 받지 않았습니다.</p><div class="row"><button class="btn primary" id="un-refresh">유니온 정보 받기</button></div><p class="muted" id="un-status"></p></div>`;
        return;
    }
    if (!ids.includes(u.current)) u.current = ids[0];
    $("#union-subtabs").innerHTML = ids.map((g) => `<button data-union="${g}" class="${g === u.current ? "on" : ""}">${esc(u.info.unions[g]?.name || g)}</button>`).join("");
    const x = u.info.unions[u.current] || {};
    const accs = accountsOf(u.current);
    const key = `${u.current}_${u.season}`;
    const season = u.seasons.find((s) => String(s.id) === u.season);
    $("#union-view").innerHTML = `
        <div class="union-card">
            <div class="union-head">
                <div><h2>${esc(x.name)}</h2><div class="muted">유니온 레벨 ${x.level ?? "-"} · 인원 ${x.members ?? "-"}/${x.max ?? "-"} · 활동 ${(x.activity ?? 0).toLocaleString()}</div></div>
                <div class="union-rank"><b>${x.ranking > 0 ? `${x.ranking.toLocaleString()}위` : "-"}</b><span class="muted">${x.ranking_percent ? `상위 ${(x.ranking_percent * 100).toFixed(2)}%` : ""}</span></div>
            </div>
            <div class="acc-chips">${accs.map((a) => `<span class="chip on">${esc(a)}</span>`).join("")}</div>
            <div class="row"><button class="btn" id="un-refresh">유니온 정보 갱신</button><span class="muted" id="un-status">${new Date(u.info.fetched_at).toLocaleString("ko-KR")} 기준</span></div>
        </div>

        <h3 class="sec">유니온 레이드</h3>
        <div class="filters">
            <select id="un-season">${u.seasons.map((s) => `<option value="${s.id}" ${String(s.id) === u.season ? "selected" : ""}>${seasonLabel(s)}${isLive(s) ? " (진행 중)" : ""}${u.raids[`${u.current}_${s.id}`] ? " ✓" : ""}</option>`).join("")}</select>
            <button class="btn primary" id="un-load">${u.raids[key] ? "다시 불러오기" : "이 시즌 불러오기"}</button>
            <button class="btn" id="un-load-all">안 받은 시즌 모두 불러오기</button>
            <span class="muted" id="un-raid-status"></span>
        </div>
        <div id="un-raid">${u.raids[key] ? raidHtml(u.raids[key]) : `<p class="muted">${season ? "아직 불러오지 않은 시즌입니다." : ""} 상세 기록은 블라블라에 로그인한 계정(케니)이 속한 유니온만 받을 수 있습니다.</p>`}</div>

        <h3 class="sec">메모</h3>
        <textarea id="un-memo" rows="3" class="union-memo" placeholder="유니온 규칙, 공략, 기타 메모">${esc(u.memos[u.current] || "")}</textarea>
        <div class="row end"><span class="muted" id="un-memo-status"></span><button class="btn" id="un-memo-save">메모 저장</button></div>`;
}

function deck(squad) {
    return squad.map((tid) => {
        const m = u.meta?.get(u.idMap?.get(tid));
        return m ? `<img class="dk" src="${portraitUrl(m.resource)}" alt="${esc(m.name)}" title="${esc(m.name)}">` : "";
    }).join("");
}

// 가입순(추정): 블라블라는 가입일을 주지 않으므로
//   ① 저장된 시즌 기록에서 처음 공격한 시즌, ② 허브가 처음 본 날짜(두 번째 갱신부터 기록), ③ 블라블라 목록 순서
function joinKey(id, apiIndex) {
    let first = Infinity;
    for (const s of u.seasons) {
        const r = u.raids[`${u.current}_${s.id}`];
        if (r?.attacks.some((a) => a.openid === id)) first = Math.min(first, s.start_ts * 1000);
    }
    const seen = u.members[u.current]?.firstSeen?.[id];
    if (seen) first = Math.min(first, new Date(seen).getTime());
    return [first, apiIndex];
}

function raidHtml(r) {
    // 내 계정 강조: 이 유니온 소속 계정 이름과 게임 닉네임이 같으면 내 계정으로 봄
    const accs = accountsOf(r.guild);
    const accOf = (nick) => accs.find((a) => a === nick) || "";
    const want = u.diffTab === "hard" ? 2 : u.diffTab === "normal" ? 1 : 0;
    const attacks = r.attacks.filter((a) => !want || a.diff === want);
    const days = [...new Set(r.attacks.map((a) => a.day))].sort((a, b) => a - b);
    const total = attacks.reduce((s, a) => s + a.damage, 0);

    // 현재 멤버 전원 + 이 시즌에 공격했지만 지금은 없는 사람
    const roster = u.members[u.current]?.list || [];
    const rows = new Map(roster.map((m, i) => [m.id, { id: m.id, nick: m.nick, synchro: m.synchro, apiIndex: i, current: true, list: [] }]));
    // 멤버 목록을 아직 안 받았으면 탈퇴 여부를 알 수 없으므로 모두 현재 멤버로 취급
    for (const a of r.attacks) if (!rows.has(a.openid)) rows.set(a.openid, { id: a.openid, nick: a.nick, synchro: null, apiIndex: 999, current: !roster.length, list: [] });
    for (const a of attacks) rows.get(a.openid).list.push(a);
    const all = [...rows.values()].map((m) => ({
        ...m, dmg: m.list.reduce((s, a) => s + a.damage, 0), join: joinKey(m.id, m.apiIndex),
        byDay: days.map((d) => ({ hard: m.list.filter((a) => a.day === d && a.diff === 2).length, normal: m.list.filter((a) => a.day === d && a.diff === 1).length })),
    }));
    const byJoin = (a, b) => a.join[0] - b.join[0] || a.join[1] - b.join[1];
    all.sort(u.sort === "damage" ? (a, b) => b.dmg - a.dmg : u.sort === "missing" ? (a, b) => (a.list.length > 0) - (b.list.length > 0) || byJoin(a, b) : byJoin);
    all.sort((a, b) => b.current - a.current); // 지금은 없는 사람은 항상 아래

    const current = all.filter((m) => m.current);
    const missing = current.filter((m) => !m.list.length);
    const dayCell = (d) => {
        if (!d.hard && !d.normal) return `<span class="miss">-</span>`;
        return (d.hard ? `<span class="pill hard">하드 ${d.hard}</span>` : "") + (d.normal ? `<span class="pill">노말 ${d.normal}</span>` : "");
    };
    const cols = 5 + days.length;

    return `
        <div class="union-summary">
            <div><span class="muted">도달</span><b>${DIFF[r.diff] || "-"} ${r.level ?? ""}레벨</b></div>
            <div><span class="muted">총 딜량${want ? ` (${DIFF[want]})` : ""}</span><b>${fmtDmg(total)}</b></div>
            <div><span class="muted">참여 / 전체 멤버</span><b>${current.length - missing.length} / ${current.length || "-"}명</b></div>
            <div><span class="muted">미참여${want ? ` (${DIFF[want]})` : ""}</span><b class="${missing.length ? "bad" : "good"}">${roster.length ? `${missing.length}명` : "멤버 목록 필요"}</b></div>
        </div>
        ${missing.length ? `<p class="missing-line">미참여${want ? `(${DIFF[want]})` : ""}: ${missing.map((m) => esc(m.nick)).join(", ")}</p>` : ""}
        <div class="boss-grid">${r.bosses.map((b) => {
            const left = b.max ? (b.hp / b.max) * 100 : 0;
            return `<div class="boss"><div class="boss-name">${b.element ? `<img class="el" src="img/${ELEMENT_ICON[b.element]}.png" alt="${ELEMENT[b.element]}">` : ""}${esc(b.name)}</div>
                <div class="hpbar"><div style="width:${left}%"></div></div><div class="muted">${b.hp ? `남은 HP ${left.toFixed(1)}%` : "처치 완료"}</div></div>`;
        }).join("")}</div>
        <div class="filters">
            <div class="view-toggle" id="un-diff">${[["all", "전체"], ["hard", "하드"], ["normal", "노말"]].map(([k, l]) => `<button data-diff="${k}" class="${u.diffTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
            <select id="un-sort">${[["join", "가입순 (추정)"], ["damage", "딜량순"], ["missing", "미참여 먼저"]].map(([k, l]) => `<option value="${k}" ${u.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
            <button class="btn" id="un-members">멤버 목록 갱신</button>
            <span class="muted">${u.members[u.current] ? `멤버 ${new Date(u.members[u.current].fetched_at).toLocaleDateString("ko-KR")} 기준` : ""}</span>
        </div>
        <div class="table-wrap"><table class="stats union-members">
            <thead><tr><th class="sticky"># 닉네임</th><th>싱크로</th>${days.map((d) => `<th>${d + 1}일차</th>`).join("")}<th>공격</th><th>총 딜량</th><th>비중</th></tr></thead>
            <tbody>${all.map((m, i) => `<tr class="${accOf(m.nick) ? "mine" : ""} ${m.current ? "" : "left"} ${m.list.length ? "" : "absent"}" data-member="${esc(m.id)}">
                <td class="sticky"><span class="muted">${i + 1}</span> <b>${esc(m.nick)}</b>${accOf(m.nick) ? ` <span class="mine-tag">내 계정</span>` : ""}${m.current ? "" : ` <span class="muted">(지금은 없음)</span>`}</td>
                <td>${m.synchro ?? "-"}</td>${m.byDay.map((d) => `<td>${dayCell(d)}</td>`).join("")}
                <td>${m.list.length || `<span class="miss">미참여</span>`}</td><td><b>${m.dmg ? fmtDmg(m.dmg) : "-"}</b></td><td>${total && m.dmg ? ((m.dmg / total) * 100).toFixed(1) + "%" : ""}</td></tr>
                ${u.openMember === m.id && m.list.length ? `<tr class="member-detail"><td colspan="${cols}">${m.list.slice().sort((a, b) => a.day - b.day || b.damage - a.damage).map((a) => `<div class="attack">
                    <span class="muted">${a.day + 1}일차</span>${a.element ? `<img class="el" src="img/${ELEMENT_ICON[a.element]}.png" alt="">` : ""}<b>${esc(a.boss)}</b>
                    <span class="pill ${a.diff === 2 ? "hard" : ""}">${DIFF[a.diff]} ${a.level}</span><span>${fmtDmg(a.damage)}</span>${a.final ? `<span class="pill final">막타</span>` : ""}
                    <span class="dks">${deck(a.squad)}</span></div>`).join("")}</td></tr>` : ""}`).join("")}</tbody>
        </table></div>`;
}

// ---------- 동작 ----------
async function refreshInfo() {
    if (!getAccessKey()) { alert("도감 탭의 「설정」에서 접속 키를 먼저 넣어 주세요."); return; }
    $("#un-status").textContent = "블라블라에서 받는 중… (10초 정도)";
    try {
        const info = await fetchUnions();
        u.info = info;
        await setDoc(doc(db, "union_info", "latest"), { fetched_at: info.fetched_at, data: JSON.stringify(info) });
        render();
    } catch (e) { $("#un-status").textContent = `실패: ${e.message}`; }
}

async function loadSeason() {
    const s = u.seasons.find((x) => String(x.id) === u.season);
    if (!s) return;
    $("#un-raid-status").textContent = "받는 중…";
    try {
        const r = normalizeRaid(await fetchUnionRaid(u.current, u.season, isLive(s)));
        const key = `${u.current}_${u.season}`;
        await setDoc(doc(db, "union_raids", key), { guild: r.guild, season: r.season, fetched_at: r.fetched_at, data: JSON.stringify(r) });
        u.raids[key] = r;
        await refreshMembers(true);
        render();
    } catch (e) { $("#un-raid-status").textContent = `실패: ${e.message}`; }
}

// 블라블라에 남아 있는 지난 시즌을 한 번에 저장 (하나씩 순서대로)
async function loadAllSeasons() {
    const todo = u.seasons.filter((s) => !u.raids[`${u.current}_${s.id}`]);
    if (!todo.length) { $("#un-raid-status").textContent = "모든 시즌을 이미 받았습니다."; return; }
    const keep = u.season;
    for (const [i, s] of todo.entries()) {
        $("#un-raid-status").textContent = `받는 중 ${i + 1}/${todo.length} (${seasonLabel(s)})`;
        try {
            const r = normalizeRaid(await fetchUnionRaid(u.current, String(s.id), isLive(s)));
            await setDoc(doc(db, "union_raids", `${u.current}_${s.id}`), { guild: r.guild, season: r.season, fetched_at: r.fetched_at, data: JSON.stringify(r) });
            u.raids[`${u.current}_${s.id}`] = r;
        } catch (e) { $("#un-raid-status").textContent = `실패: ${e.message}`; return; }
    }
    u.season = keep;
    render();
    $("#un-raid-status").textContent = `${todo.length}개 시즌을 저장했습니다.`;
}

// 멤버 목록: 두 번째 갱신부터 새로 보인 멤버의 날짜를 기록해서 가입순 추정에 씀
async function refreshMembers(silent = false) {
    try {
        const r = await fetchUnionMembers(u.current);
        const prev = u.members[u.current];
        const firstSeen = { ...(prev?.firstSeen || {}) };
        if (prev) for (const m of r.members) if (!prev.list.some((p) => p.id === m.id) && !firstSeen[m.id]) firstSeen[m.id] = r.fetched_at;
        u.members[u.current] = { fetched_at: r.fetched_at, list: r.members, firstSeen };
        await setDoc(doc(db, "union_members", u.current), { data: JSON.stringify(u.members[u.current]) });
        render();
    } catch (e) { if (!silent) $("#un-raid-status").textContent = `멤버 목록 실패: ${e.message}`; }
}

async function saveMemo() {
    u.memos[u.current] = $("#un-memo").value;
    $("#un-memo-status").textContent = "저장 중…";
    try {
        await setDoc(doc(db, "unions", u.current), { memo: u.memos[u.current] }, { merge: true });
        $("#un-memo-status").textContent = "저장했습니다.";
    } catch (e) { $("#un-memo-status").textContent = `실패: ${e.message}`; }
}

let initPromise = null;
export const initUnion = () => (initPromise ||= setup());
async function setup() {
    $("#union-view").innerHTML = `<p class="empty">유니온 정보를 불러오는 중…</p>`;
    const [infoDoc, raidSnap, memoSnap, memberSnap, seasons, idList, meta] = await Promise.all([
        getDoc(doc(db, "union_info", "latest")),
        getDocs(collection(db, "union_raids")),
        getDocs(collection(db, "unions")),
        getDocs(collection(db, "union_members")),
        fetch(cdnUrl("raid/raid_list.json")).then((r) => r.json()).catch(() => []),
        fetch(cdnUrl("character/character_id_map.json")).then((r) => r.json()).catch(() => []),
        loadNikkeList(),
    ]);
    u.info = infoDoc.exists() ? JSON.parse(infoDoc.data().data) : null;
    raidSnap.forEach((d) => (u.raids[d.id] = JSON.parse(d.data().data)));
    memoSnap.forEach((d) => (u.memos[d.id] = d.data().memo || ""));
    memberSnap.forEach((d) => (u.members[d.id] = JSON.parse(d.data().data)));
    u.seasons = seasons.filter((s) => s.start_ts * 1000 <= Date.now()).sort((a, b) => b.start_ts - a.start_ts);
    u.season = String(u.seasons[0]?.id || "");
    u.idMap = new Map(idList.map((x) => [x.id, x.name_code]));
    u.meta = meta;

    $("#union-subtabs").addEventListener("click", (e) => {
        const g = e.target.dataset.union;
        if (!g) return;
        u.current = g;
        u.openMember = null;
        localStorage.setItem("hub_union_guild", g);
        render();
    });
    $("#union-view").addEventListener("click", (e) => {
        if (e.target.id === "un-refresh") refreshInfo();
        if (e.target.id === "un-load") loadSeason();
        if (e.target.id === "un-load-all") loadAllSeasons();
        if (e.target.id === "un-members") refreshMembers();
        const diff = e.target.closest("[data-diff]")?.dataset.diff;
        if (diff) { u.diffTab = diff; render(); }
        if (e.target.id === "un-memo-save") saveMemo();
        const m = e.target.closest("tr[data-member]")?.dataset.member;
        if (m) { u.openMember = u.openMember === m ? null : m; render(); }
    });
    $("#union-view").addEventListener("change", (e) => {
        if (e.target.id === "un-season") { u.season = e.target.value; u.openMember = null; render(); }
        if (e.target.id === "un-sort") { u.sort = e.target.value; localStorage.setItem("hub_union_sort", u.sort); render(); }
    });
    render();
}
