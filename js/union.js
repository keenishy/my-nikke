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
    histSort: localStorage.getItem("hub_union_hist_sort") || "rate",
    histOpen: localStorage.getItem("hub_union_hist_open") === "1",
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
        <div id="un-raid">${u.raids[key] ? raidHtml(u.raids[key]) : `<p class="muted">${season ? "아직 불러오지 않은 시즌입니다." : ""} 상세 기록은 이 유니온 소속 계정의 블라블라 쿠키가 Cloudflare 비밀값에 있어야 받을 수 있습니다 (이름은 아무거나, 자동으로 찾아 씀).</p>`}</div>

        ${historyHtml()}

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
    if (!isOwnGuild(r, r.guild)) return `<p class="warn">저장된 이 시즌 기록(${new Date(r.fetched_at).toLocaleString("ko-KR")} 받음)은 다른 유니온 것으로 보입니다: 공격한 사람 ${esc([...new Set(r.attacks.map((a) => a.nick))].join(", "))}.<br>
        ${esc(guildHint(r.guild))}. 「다시 불러오기」를 눌러도 이 문구가 남으면 버튼 옆에 나오는 메시지를 확인해 주세요.</p>`;
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

// ---------- 멤버 시즌 참여 기록 ----------
// 저장해 둔 시즌 기록을 모아서 멤버마다 시즌별 참여 여부를 보여 줌
// 가입일을 알 수 없으므로, 처음 공격한 시즌(또는 허브가 처음 본 날) 이전 시즌은 "가입 전"으로 보고 계산에서 뺌
function historyHtml() {
    const g = u.current;
    const saved = Object.values(u.raids).filter((r) => r.guild === g).sort((a, b) => Number(b.season) - Number(a.season));
    if (saved.length < 2) return "";
    const info = new Map(u.seasons.map((s) => [String(s.id), s]));
    const label = (r) => info.get(String(r.season))?.season_start_date.slice(5, 10).replace("-", "/") || String(r.season).slice(-2);
    const startOf = (r) => (info.get(String(r.season))?.start_ts || 0) * 1000;

    const roster = u.members[g]?.list || [];
    const people = roster.length ? roster.map((m) => ({ id: m.id, nick: m.nick }))
        : [...new Map(saved.flatMap((r) => r.attacks.map((a) => [a.openid, { id: a.openid, nick: a.nick }]))).values()];
    const accs = accountsOf(g);
    const rows = people.map((p) => {
        const per = saved.map((r) => {
            const list = r.attacks.filter((a) => a.openid === p.id);
            return { n: list.length, dmg: list.reduce((s, a) => s + a.damage, 0) };
        });
        // 처음 참여한 시즌 = 가장 오래된 참여 시즌. 그보다 앞은 가입 전으로 봄
        let first = per.map((x) => x.n > 0).lastIndexOf(true);
        const seen = u.members[g]?.firstSeen?.[p.id];
        if (seen) { const i = saved.findIndex((r) => startOf(r) <= new Date(seen).getTime()); if (i >= 0 && (first < 0 || i < first)) first = i; }
        // 저장된 시즌에 공격 기록이 전혀 없으면 언제 들어왔는지 알 수 없으므로 최근 시즌만 셈
        const span = first < 0 ? 1 : first + 1;
        const joined = per.slice(0, span).filter((x) => x.n > 0);
        return {
            ...p, per, span, joinedCount: joined.length,
            rate: span ? joined.length / span : 0,
            avg: joined.length ? joined.reduce((s, x) => s + x.dmg, 0) / joined.length : 0,
            mine: accs.includes(p.nick),
        };
    });
    rows.sort(u.histSort === "dmg" ? (a, b) => b.avg - a.avg : (a, b) => a.rate - b.rate || a.avg - b.avg);

    return `<details class="union-history" ${u.histOpen ? "open" : ""}><summary><h3 class="sec">멤버 시즌 참여 기록 <small class="muted">(저장된 ${saved.length}시즌 · ${roster.length ? "현재 멤버" : "공격 기록이 있는 사람"} 기준)</small></h3></summary>
        <div class="filters">
            <div class="view-toggle" id="un-hist-sort">${[["rate", "참여율 낮은 순"], ["dmg", "평균 딜 순"]].map(([k, l]) => `<button data-hsort="${k}" class="${u.histSort === k ? "on" : ""}">${l}</button>`).join("")}</div>
            <span class="muted">숫자 = 그 시즌 공격 횟수 · ✕ = 미참여 · 빈칸 = 가입 전(추정)</span>
        </div>
        <div class="table-wrap"><table class="stats hist-table">
            <thead><tr><th class="sticky">닉네임</th><th>참여</th><th>시즌 평균 딜</th>${saved.map((r) => `<th>${label(r)}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((m) => `<tr class="${m.mine ? "mine" : ""}">
                <td class="sticky"><b>${esc(m.nick)}</b>${m.mine ? ` <span class="mine-tag">내 계정</span>` : ""}${m.joinedCount ? "" : ` <span class="muted">(참여 기록 없음)</span>`}</td>
                <td><b class="${m.rate >= 0.9 ? "good" : m.rate < 0.6 ? "bad" : ""}">${m.joinedCount}/${m.span}</b> <small class="muted">${Math.round(m.rate * 100)}%</small></td>
                <td>${m.avg ? fmtDmg(Math.round(m.avg)) : "-"}</td>
                ${m.per.map((x, i) => i >= m.span ? `<td class="dim"></td>` : x.n ? `<td title="${fmtDmg(x.dmg)}">${x.n}</td>` : `<td class="miss">✕</td>`).join("")}
            </tr>`).join("")}</tbody>
        </table></div></details>`;
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

// 받은 공격 기록이 이 유니온 멤버 것인지 확인 (다른 유니온 기록이 섞여 저장되는 것 방지)
// 멤버 번호·닉네임, 허브가 아는 계정별 소속 유니온 중 하나라도 맞으면 이 유니온 기록으로 봄
function isOwnGuild(r, g) {
    const roster = u.members[g]?.list || [];
    if (!roster.length || !r.attacks.length) return true;
    const ids = new Set(roster.map((m) => m.id)), nicks = new Set(roster.map((m) => m.nick)), mine = accountsOf(g);
    return r.attacks.some((a) => ids.has(a.openid) || nicks.has(a.nick) || mine.includes(a.nick));
}
const guildHint = (g) => `이 유니온의 허브 계정: ${accountsOf(g).join(", ") || "없음"} · 멤버 목록 ${u.members[g]?.list.length ?? 0}명`;
function checkOwnGuild(r, g) {
    if (!isOwnGuild(r, g))
        throw new Error(`이 유니온 멤버가 아닌 사람의 기록만 왔습니다 (${[...new Set(r.attacks.map((a) => a.nick))].join(", ")}). ${guildHint(g)}`);
}

// 받는 도중에 다른 유니온 탭을 눌러도 처음 고른 유니온에 저장되도록 유니온·시즌을 먼저 고정
async function loadSeason() {
    const g = u.current, season = u.season;
    const s = u.seasons.find((x) => String(x.id) === season);
    if (!s) return;
    $("#un-raid-status").textContent = "받는 중…";
    try {
        const r = normalizeRaid(await fetchUnionRaid(g, season, isLive(s)));
        await refreshMembers(true, g);
        checkOwnGuild(r, g);
        const key = `${g}_${season}`;
        await setDoc(doc(db, "union_raids", key), { guild: r.guild, season: r.season, fetched_at: r.fetched_at, data: JSON.stringify(r) });
        u.raids[key] = r;
        render();
    } catch (e) { $("#un-raid-status").textContent = `실패: ${e.message}`; }
}

// 블라블라에 남아 있는 지난 시즌을 한 번에 저장 (하나씩 순서대로)
async function loadAllSeasons() {
    const g = u.current;
    const todo = u.seasons.filter((s) => !u.raids[`${g}_${s.id}`]);
    if (!todo.length) { $("#un-raid-status").textContent = "모든 시즌을 이미 받았습니다."; return; }
    const keep = u.season;
    for (const [i, s] of todo.entries()) {
        $("#un-raid-status").textContent = `받는 중 ${i + 1}/${todo.length} (${seasonLabel(s)})`;
        try {
            const r = normalizeRaid(await fetchUnionRaid(g, String(s.id), isLive(s)));
            checkOwnGuild(r, g);
            await setDoc(doc(db, "union_raids", `${g}_${s.id}`), { guild: r.guild, season: r.season, fetched_at: r.fetched_at, data: JSON.stringify(r) });
            u.raids[`${g}_${s.id}`] = r;
        } catch (e) { $("#un-raid-status").textContent = `실패: ${e.message}`; return; }
    }
    u.season = keep;
    render();
    $("#un-raid-status").textContent = `${todo.length}개 시즌을 저장했습니다.`;
}

// 멤버 목록: 두 번째 갱신부터 새로 보인 멤버의 날짜를 기록해서 가입순 추정에 씀
async function refreshMembers(silent = false, g = u.current) {
    try {
        const r = await fetchUnionMembers(g);
        const prev = u.members[g];
        const firstSeen = { ...(prev?.firstSeen || {}) };
        if (prev) for (const m of r.members) if (!prev.list.some((p) => p.id === m.id) && !firstSeen[m.id]) firstSeen[m.id] = r.fetched_at;
        u.members[g] = { fetched_at: r.fetched_at, list: r.members, firstSeen };
        await setDoc(doc(db, "union_members", g), { data: JSON.stringify(u.members[g]) });
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
    // 예전 버그로 다른 유니온 기록이 들어간 문서는 "안 받은 시즌"으로 둬서 다시 불러오면 바로잡히게 함
    raidSnap.forEach((d) => { const r = JSON.parse(d.data().data); if (d.id === `${r.guild}_${r.season}`) u.raids[d.id] = r; });
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
        const hs = e.target.closest("[data-hsort]")?.dataset.hsort;
        if (hs) { u.histSort = hs; localStorage.setItem("hub_union_hist_sort", hs); render(); }
        const diff = e.target.closest("[data-diff]")?.dataset.diff;
        if (diff) { u.diffTab = diff; render(); }
        if (e.target.id === "un-memo-save") saveMemo();
        const m = e.target.closest("tr[data-member]")?.dataset.member;
        if (m) { u.openMember = u.openMember === m ? null : m; render(); }
    });
    $("#union-view").addEventListener("toggle", (e) => {
        if (e.target.classList?.contains("union-history")) { u.histOpen = e.target.open; localStorage.setItem("hub_union_hist_open", u.histOpen ? "1" : "0"); }
    }, true);
    $("#union-view").addEventListener("change", (e) => {
        if (e.target.id === "un-season") { u.season = e.target.value; u.openMember = null; render(); }
        if (e.target.id === "un-sort") { u.sort = e.target.value; localStorage.setItem("hub_union_sort", u.sort); render(); }
    });
    render();
}
