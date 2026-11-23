import { doc, getDoc, getDocs, setDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./store.js";
import { ACCOUNTS } from "./config.js";
import { readWorkbook } from "./xlsx-colors.js";

// 유니온 멤버 기록부 (union_book/{유니온} = { data: JSON { entries: [기록] } })
// 기록: { key, id: 블라블라 멤버 id|"", uid, nicks: [예전 닉 … 지금 닉], joinDate: "YYYY-MM-DD", joinLevel, joinSynchro,
//         joinCampaign: "노말 하드" (예: "48-36 40-35"), joinExtra: 타워 층수, memo, left: null | { date, type: "탈퇴"|"추방"|"", reason }, src: "excel"|"auto"|"manual" }
// 지금 멤버는 유니온 탭에서 받은 멤버 목록(union_members)과 id(없으면 닉네임)로 이어 붙여 보여 줌
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const squash = (s) => String(s || "").replace(/\s/g, "").toLowerCase();
const newKey = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const md = (d) => (d ? d.slice(2).replace(/-/g, ".") : "");
const daysSince = (d) => (d ? Math.floor((Date.parse(today()) - Date.parse(d)) / 86400000) : null);

const b = { info: null, members: {}, books: {}, raids: {}, fixed: {}, fixedAsOf: "", diff: localStorage.getItem("hub_rb_diff") || "all", current: localStorage.getItem("hub_rb_guild") || "", editing: null, sort: localStorage.getItem("hub_rb_sort") || "join" };

// ---------- 저장 ----------
async function loadBook(g) {
    if (b.books[g]) return b.books[g];
    const d = await getDoc(doc(db, "union_book", g));
    b.books[g] = d.exists() ? JSON.parse(d.data().data) : { entries: [] };
    return b.books[g];
}
const saveBook = (g) => setDoc(doc(db, "union_book", g), { data: JSON.stringify(b.books[g]) });

const nickOf = (e) => e.nicks?.[e.nicks.length - 1] || "";
const findById = (book, id) => (id ? book.entries.find((e) => e.id === id) : null);
// id가 없거나 기준 명단으로 임시 id("uid:…")만 있는 기록은 닉네임으로 이어 붙임
const findByNick = (book, nick) => book.entries.find((e) => (!e.id || e.id.startsWith("uid:")) && !e.left && (e.nicks || []).some((n) => squash(n) === squash(nick)));

// 블라블라 멤버 정보(raw)의 필드 이름만으로 UID·가입 시각을 짐작하면 유니온 번호 같은 엉뚱한 값이 들어갈 수 있어서 쓰지 않음.
// UID·가입일은 엑셀 가져오기나 직접 입력으로만 채움
const rawUid = () => "";

// ---------- 유니온 탭에서 멤버 목록을 갱신할 때 들어오고 나간 사람을 자동으로 기록 ----------
export async function recordMemberChanges(g, prevList, list, at) {
    const book = await loadBook(g);
    const date = new Date(Date.parse(at) + 9 * 3600 * 1000).toISOString().slice(0, 10);
    let changed = false;
    for (const m of list) {
        let e = findById(book, m.id) || findByNick(book, m.nick);
        const isNew = prevList && !prevList.some((p) => p.id === m.id);
        if (!e && isNew) {
            e = { key: newKey(), id: m.id, uid: "", nicks: [m.nick], joinDate: date, joinLevel: m.level ?? "", joinSynchro: m.synchro ?? "",
                joinCampaign: "", joinExtra: "", memo: "", left: null, src: "auto" };
            book.entries.push(e);
            changed = true;
        }
        if (!e) continue;
        if (!e.id || e.id.startsWith("uid:")) { e.id = m.id; changed = true; }
        if (nickOf(e) !== m.nick) { e.nicks = [...(e.nicks || []), m.nick]; changed = true; }
        if (e.left && isNew) { e.left = null; changed = true; } // 다시 들어온 경우
    }
    for (const p of prevList || []) {
        if (list.some((m) => m.id === p.id)) continue;
        let e = findById(book, p.id) || findByNick(book, p.nick);
        if (!e) { e = { key: newKey(), id: p.id, uid: "", nicks: [p.nick], joinDate: "", joinLevel: "", joinSynchro: "", joinCampaign: "", joinExtra: "", memo: "", left: null, src: "auto" }; book.entries.push(e); }
        if (!e.left) { e.left = { date, type: "", reason: "" }; changed = true; }
    }
    if (changed) await saveBook(g);
    if (b.current === g && $("#rb-view")) render();
}

// ---------- 화면 ----------
const guildIds = () => {
    const order = [];
    for (const a of ACCOUNTS) { const g = b.info?.members?.[a]; if (g && !order.includes(g)) order.push(g); }
    return order;
};
const guildName = (g) => b.info?.unions?.[g]?.name || g;

// ---------- 레이드 참여율 (유니온 레이드 탭에 저장된 시즌 기록으로) ----------
// 처음 공격한 시즌(난이도 상관없이)부터 최근 시즌까지 중, 고른 난이도(전체/하드/노말)로 1번이라도 공격한 시즌 수
const DIFF_OF = { hard: 2, normal: 1 };
function participation(g, m, diff = b.diff) {
    const roster = b.members[g]?.list || [];
    const ids = new Set(roster.map((x) => x.id));
    const seasons = (b.raids[g] || []).filter((r) => r.attacks?.some((a) => ids.has(a.openid))) // 다른 유니온 기록이 잘못 저장된 시즌은 뺌
        .sort((x, y) => Number(y.season) - Number(x.season));
    if (!seasons.length) return null;
    const mine = (r, want) => r.attacks.some((a) => a.openid === m.id && (!want || a.diff === want));
    const any = seasons.map((r) => mine(r));
    // 가입한 시즌은 알 수 없어서 처음 공격한 시즌부터 셈 (한 번도 공격 안 했으면 최근 1시즌)
    const span = any.lastIndexOf(true) + 1 || 1;
    const count = (want) => seasons.slice(0, span).filter((r) => mine(r, want)).length;
    const want = DIFF_OF[diff] || 0;
    const n = count(want);
    return { n, span, rate: n / span, last: mine(seasons[0], want), hard: count(2), normal: count(1) };
}
function partCell(p) {
    if (!p) return `<span class="dim">-</span>`;
    const cls = p.rate >= 0.8 ? "good" : p.rate >= 0.5 ? "warn-num" : "bad";
    return `<b class="${cls}">${p.n}/${p.span}</b> <small class="muted">${Math.round(p.rate * 100)}%</small>${p.last ? "" : ` <small class="bad">이번 ✕</small>`}`
        + (b.diff === "all" && p.n ? `<div class="muted small">하드 ${p.hard} · 노말 ${p.normal}</div>` : "");
}

// 고정 가입 순서 (data/join-order.json, 유니온 이름별 [UID, 닉네임] 목록)에서 이 멤버의 자리
const nickMatch = (a, c) => { a = squash(a).replace(/…$/, ""); c = squash(c).replace(/…$/, ""); return !!a && !!c && (a === c || a.startsWith(c) || c.startsWith(a)); };
function fixedIndex(g, m, e) {
    const list = b.fixed[squash(guildName(g))];
    if (!list) return -1;
    let i = e?.uid ? list.findIndex(([uid]) => uid === e.uid) : -1;
    if (i < 0) i = list.findIndex(([, nick]) => [m?.nick, ...(e?.nicks || [])].some((n) => n && nickMatch(n, nick)));
    return i;
}

// 블라블라 멤버 목록이 기준 명단보다 오래됐는지 (쿠키 만료 등으로 못 받은 사이 들어오고 나간 사람이 있음)
const staleRoster = (g) => !!b.fixed[squash(guildName(g))] && !!b.fixedAsOf && (b.members[g]?.fetched_at || "").slice(0, 10) < b.fixedAsOf;
// 지금 멤버 목록: 블라블라 목록이 최신이면 그대로, 기준 명단보다 오래됐으면 기준 명단 (블라블라에 있는 사람은 레벨·싱크로를 이어 붙임)
function rosterOf(g) {
    const api = b.members[g]?.list || [];
    if (!staleRoster(g)) return api;
    const book = b.books[g] || { entries: [] };
    return b.fixed[squash(guildName(g))].map(([uid, nick]) => {
        const e = book.entries.find((x) => x.uid === uid);
        return api.find((m) => (e?.id && m.id === e.id) || nickMatch(m.nick, nick)) || { id: e?.id || `uid:${uid}`, nick: e ? nickOf(e) || nick : nick, level: null, synchro: null };
    });
}

// 고정 순서에 있는 지금 멤버는 기록에 UID와 순서를 저장해 둠 (닉네임이 바뀌어도 UID로 이어지게)
// 블라블라 목록이 기준 명단보다 오래됐으면, 기준 명단에 없는 사람은 나간 멤버로 (나간 날·사유는 직접)
function applyFixed(g) {
    const book = b.books[g];
    const list = b.fixed[squash(guildName(g))];
    if (!book || !list) return false;
    let changed = false;
    if (staleRoster(g)) {
        const uids = new Set(list.map(([uid]) => uid));
        for (const m of b.members[g]?.list || []) {
            if (fixedIndex(g, m, findById(book, m.id)) >= 0) continue;
            let e = findById(book, m.id) || book.entries.find((x) => !x.left && (x.nicks || []).some((n) => nickMatch(n, m.nick)));
            if (!e) { e = { key: newKey(), id: m.id, uid: "", nicks: [m.nick], joinDate: "", joinLevel: "", joinSynchro: "", joinCampaign: "", joinExtra: "", memo: "", left: null, src: "auto" }; book.entries.push(e); }
            if (!e.left) { e.left = { date: "", type: "", reason: "" }; changed = true; }
        }
        for (const e of book.entries) if (!e.left && e.uid && !uids.has(e.uid) && e.src === "excel") { e.left = { date: "", type: "", reason: "" }; changed = true; }
    }
    for (const m of rosterOf(g)) {
        let e = findById(book, m.id) || book.entries.find((x) => !x.left && (x.nicks || []).some((n) => nickMatch(n, m.nick)));
        const i = fixedIndex(g, m, e);
        if (i < 0) continue;
        if (!e) { e = { key: newKey(), id: m.id, uid: "", nicks: [m.nick], joinDate: "", joinLevel: "", joinSynchro: "", joinCampaign: "", joinExtra: "", memo: "", left: null, src: "excel" }; book.entries.push(e); changed = true; }
        if (!e.id) { e.id = m.id; changed = true; }
        if (!e.uid) { e.uid = list[i][0]; changed = true; }
        if (e.order !== i + 1) { e.order = i + 1; changed = true; }
    }
    return changed;
}

function split(g) {
    const book = b.books[g] || { entries: [] };
    const roster = rosterOf(g);
    const used = new Set();
    const current = roster.map((m) => {
        const e = findById(book, m.id) || book.entries.find((x) => !used.has(x) && !x.left && (x.nicks || []).some((n) => squash(n) === squash(m.nick)));
        if (e) used.add(e);
        return { m, e };
    });
    const gone = book.entries.filter((e) => !used.has(e) && (e.left || roster.length)).map((e) => ({ e, unknown: !e.left }));
    gone.sort((x, y) => (y.e.left?.date || "").localeCompare(x.e.left?.date || ""));
    // 가입순: 엑셀 줄 순서(예전 기록지는 위가 먼저 가입) → 엑셀 이후 들어온 사람은 가입일 → 기록 없는 사람은 맨 뒤
    const joinKey = (x) => { const i = fixedIndex(g, x.m, x.e); return [i >= 0 ? i + 1 : x.e?.order ?? Infinity, x.e?.joinDate || "9999", x.m.nick]; };
    const cmp = (a, c) => { const p = joinKey(a), q = joinKey(c); return p[0] - q[0] || p[1].localeCompare(q[1]) || p[2].localeCompare(q[2], "ko"); };
    if (b.sort === "part") current.sort((a, c) => (participation(g, a.m)?.rate ?? 2) - (participation(g, c.m)?.rate ?? 2));
    else if (b.sort === "synchro") current.sort((a, c) => (c.m.synchro || 0) - (a.m.synchro || 0));
    else if (b.sort === "name") current.sort((a, c) => a.m.nick.localeCompare(c.m.nick, "ko"));
    else current.sort(cmp);
    return { current, gone, roster };
}

const nickCell = (e, m) => {
    const nicks = e?.nicks || [];
    const now = m?.nick || nickOf(e);
    const old = nicks.filter((n) => n !== now);
    return `<b>${esc(now)}</b>${old.length ? `<div class="muted small">예전: ${old.map(esc).join(" → ")}</div>` : ""}`;
};
const joinCell = (e) => (e?.joinDate ? `${md(e.joinDate)}<div class="muted small">${daysSince(e.joinDate)}일째</div>` : `<span class="dim">-</span>`);
// 캠페인 칸: "48-36 40-35" + 타워 → "N 48-36 · H 40-35 · 타워 1089층"
function campCell(e) {
    const [n, h] = String(e?.joinCampaign || "").split(/\s+/);
    const parts = [n && `<span class="muted">N</span> ${esc(n)}`, h && `<span class="muted">H</span> ${esc(h)}`, e?.joinExtra && `<span class="muted">타워</span> ${esc(e.joinExtra)}층`].filter(Boolean);
    return parts.join(" · ") || `<span class="dim">-</span>`;
}
const lvCell = (lv, sy) => (lv || sy ? `${lv || "-"} / ${sy || "-"}` : `<span class="dim">-</span>`);

function render() {
    const ids = guildIds();
    if (!b.info) { $("#rb-subtabs").innerHTML = ""; $("#rb-view").innerHTML = `<p class="empty">유니온 정보가 없습니다. 「유니온 레이드」 탭에서 「유니온 정보 받기」를 먼저 해 주세요.</p>`; return; }
    if (!ids.includes(b.current)) b.current = ids[0];
    $("#rb-subtabs").innerHTML = ids.map((g) => `<button data-guild="${g}" class="${g === b.current ? "on" : ""}">${esc(guildName(g))}</button>`).join("");
    const g = b.current;
    const { current, gone, roster } = split(g);
    const fetched = b.members[g]?.fetched_at;
    $("#rb-view").innerHTML = `
        ${staleRoster(g) ? `<p class="warn">블라블라 멤버 목록이 ${fetched ? new Date(fetched).toLocaleDateString("ko-KR") : "아직 없음"} 것이라, ${md(b.fixedAsOf)}에 정리한 명단으로 지금 멤버를 보여 줍니다. 명단에 없는 사람은 나간 멤버로 옮겼습니다(나간 날·사유는 줄을 눌러 입력). 쿠키를 갱신하고 「멤버 목록 갱신」을 하면 블라블라 목록을 따릅니다.</p>` : ""}
        <p class="muted">멤버 목록 ${fetched ? `${new Date(fetched).toLocaleDateString("ko-KR")} 기준 · ` : ""}유니온 레이드 탭에서 「멤버 목록 갱신」을 누르면 새로 들어오거나 나간 사람이 자동으로 기록됩니다. 줄을 누르면 수정합니다.</p>
        <h3 class="sec">지금 멤버 <small class="muted">${roster.length}명</small>
            <select id="rb-sort" class="rb-sort">${[["join", "가입순"], ["part", "참여율 낮은 순"], ["synchro", "싱크로 높은 순"], ["name", "이름순"]].map(([k, l]) => `<option value="${k}" ${b.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select></h3>
        ${roster.length ? `<div class="table-wrap"><table class="stats rb-table"><thead><tr><th>#</th><th>닉네임</th><th>UID</th><th>가입일</th><th>가입 당시<br><small>지휘관 Lv / 싱크로</small></th><th>가입 당시<br><small>캠페인 · 타워</small></th><th>지금<br><small>지휘관 Lv / 싱크로</small></th><th>레이드 참여 <select id="rb-diff" class="rb-sort">${[["all", "전체"], ["hard", "하드"], ["normal", "노말"]].map(([k, l]) => `<option value="${k}" ${b.diff === k ? "selected" : ""}>${l}</option>`).join("")}</select><br><small>참여 시즌 / 처음 공격 뒤 시즌</small></th><th>메모</th></tr></thead><tbody>
            ${current.map(({ m, e }, i) => `<tr data-member="${esc(m.id)}"><td class="muted">${i + 1}</td><td>${nickCell(e, m)}</td><td>${esc(e?.uid || rawUid(m)) || `<span class="dim">-</span>`}</td>
                <td>${joinCell(e)}</td><td>${lvCell(e?.joinLevel, e?.joinSynchro)}</td><td>${campCell(e)}</td>
                <td>${lvCell(m.level, m.synchro)}</td><td>${partCell(participation(g, m))}</td><td class="rb-memo">${esc(e?.memo || "")}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted">멤버 목록이 아직 없습니다. 유니온 레이드 탭에서 「멤버 목록 갱신」을 눌러 주세요.</p>`}
        <h3 class="sec">나간 멤버 <small class="muted">${gone.length}명</small></h3>
        ${gone.length ? `<div class="table-wrap"><table class="stats rb-table"><thead><tr><th>닉네임</th><th>UID</th><th>가입일</th><th>나간 날</th><th>구분</th><th>사유</th><th>메모</th></tr></thead><tbody>
            ${gone.map(({ e, unknown }) => `<tr data-key="${esc(e.key)}"><td>${nickCell(e)}</td><td>${esc(e.uid) || `<span class="dim">-</span>`}</td><td>${e.joinDate ? md(e.joinDate) : `<span class="dim">-</span>`}</td>
                <td>${unknown ? `<span class="warn-num">명단에 없음</span>` : e.left.date ? md(e.left.date) : `<span class="dim">-</span>`}</td>
                <td>${e.left?.type ? `<span class="rb-type ${e.left.type === "추방" ? "kick" : ""}">${esc(e.left.type)}</span>` : ""}</td><td>${esc(e.left?.reason || "")}</td><td class="rb-memo">${esc(e.memo || "")}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted">기록이 없습니다.</p>`}`;
}

// ---------- 수정 창 ----------
function openEdit(e, m) {
    const g = b.current;
    const book = b.books[g];
    b.editing = e ? { e, isNew: false } : { e: { key: newKey(), id: m?.id || "", uid: m ? rawUid(m) : "", nicks: m ? [m.nick] : [], joinDate: "", joinLevel: "", joinSynchro: "", joinCampaign: "", joinExtra: "", memo: "", left: null, src: "manual" }, isNew: true };
    const x = b.editing.e;
    const f = $("#rb-form");
    f.nicks.value = (x.nicks || []).join(" > ");
    f.uid.value = x.uid || "";
    f.joinDate.value = x.joinDate || "";
    f.joinLevel.value = x.joinLevel ?? "";
    f.joinSynchro.value = x.joinSynchro ?? "";
    f.joinCampaign.value = x.joinCampaign || "";
    f.joinExtra.value = x.joinExtra || "";
    f.memo.value = x.memo || "";
    f.isLeft.checked = !!x.left;
    f.leftDate.value = x.left?.date || "";
    f.leftType.value = x.left?.type || "";
    f.leftReason.value = x.left?.reason || "";
    $("#rb-left-fields").hidden = !x.left;
    $("#rb-title").textContent = b.editing.isNew ? "멤버 기록 추가" : `${nickOf(x) || "멤버"} 기록`;
    $("#rb-delete").hidden = b.editing.isNew;
    if (!book.entries.includes(x) && !b.editing.isNew) book.entries.push(x);
    $("#rb-dialog").showModal();
}

async function saveEdit(ev) {
    ev.preventDefault();
    const f = ev.target, g = b.current, book = b.books[g], x = b.editing.e;
    x.nicks = f.nicks.value.split(">").map((s) => s.trim()).filter(Boolean);
    if (!x.nicks.length) { f.nicks.focus(); return; }
    Object.assign(x, { uid: f.uid.value.trim(), joinDate: f.joinDate.value, joinLevel: f.joinLevel.value.trim(), joinSynchro: f.joinSynchro.value.trim(),
        joinCampaign: f.joinCampaign.value.trim(), joinExtra: f.joinExtra.value.trim(), memo: f.memo.value.trim(),
        left: f.isLeft.checked ? { date: f.leftDate.value, type: f.leftType.value, reason: f.leftReason.value.trim() } : null, src: "manual" });
    if (b.editing.isNew) book.entries.push(x);
    try { await saveBook(g); $("#rb-dialog").close(); render(); } catch (err) { alert(`저장하지 못했습니다: ${err.message}`); }
}

async function removeEdit() {
    const g = b.current, x = b.editing.e;
    if (!confirm(`「${nickOf(x)}」 기록을 지울까요?`)) return;
    b.books[g].entries = b.books[g].entries.filter((e) => e !== x);
    try { await saveBook(g); $("#rb-dialog").close(); render(); } catch (err) { alert(`지우지 못했습니다: ${err.message}`); }
}

// ---------- 예전 레이드 기록지(엑셀) 가져오기 ----------
// 시트 이름 = 유니온 이름. 위쪽은 지금 멤버(UID | 닉네임 | 시즌별 공격 순번…), "사유" 머리줄 아래는 나간 멤버(UID | 닉네임 | 탈퇴일 | 사유)
// 가입 칸 "260815 771 630" = 가입일 지휘관 레벨 싱크로, 그 오른쪽 "48-36 40-35 1089" = 캠페인 노말 하드 타워(층)
const JOIN = /^(2[3-9][01]\d[0-3]\d)?\s*(\d{2,4})\s*\/?\s*(\d{2,4})$/;
const CAMP = /^(\d+-\d+[A-Z]?)\s+(\d+-\d+[A-Z]?)(?:\s+(\d+))?/i;
const ymd = (s) => (s ? `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}` : "");

function parseSheet(sheet) {
    const t = (r, c) => (sheet.cells.get(`${r},${c}`) || []).map((x) => x.text).join("").trim();
    const maxRow = Math.max(0, ...[...sheet.cells.keys()].map((k) => Number(k.split(",")[0])));
    const hasUid = t(1, 1) === "UID";
    const nameCol = hasUid ? 2 : 1;
    let leftHead = 0;
    for (let r = 1; r <= maxRow; r++) if (t(r, 4) === "사유" || /^탈퇴/.test(t(r, 3))) { leftHead = r; break; }
    const junk = (s) => !s || /^\d+$/.test(s) || /부터$/.test(s) || /^한섭\)/.test(s) || /^유니온/.test(s);
    const rowInfo = (r) => {
        const e = { uid: hasUid ? t(r, 1).replace(/\D/g, "") : "", nicks: t(r, nameCol).split(">").map((s) => s.trim()).filter(Boolean), order: r };
        for (let c = nameCol + 1; c <= 60; c++) {
            const m = t(r, c).match(JOIN);
            if (!m || (!m[1] && c !== nameCol + 1)) continue;
            Object.assign(e, { joinDate: ymd(m[1]), joinLevel: m[2], joinSynchro: m[3] });
            const cm = t(r, c + 1).match(CAMP);
            if (cm) Object.assign(e, { joinCampaign: `${cm[1]} ${cm[2]}`, joinExtra: cm[3] || "" });
            break;
        }
        return e;
    };
    const current = [], gone = [];
    for (let r = 2, empty = 0; r <= (leftHead ? leftHead - 1 : maxRow) && empty < 4; r++) {
        const name = t(r, nameCol);
        if (junk(name)) { empty++; continue; }
        empty = 0;
        current.push(rowInfo(r));
    }
    if (leftHead) for (let r = leftHead + 1, empty = 0; r <= maxRow && empty < 4; r++) {
        const name = t(r, nameCol);
        if (junk(name)) { empty++; continue; }
        empty = 0;
        const e = rowInfo(r);
        const c3 = t(r, 3), c4 = t(r, 4);
        const d = c3.match(/(2[3-9][01]\d[0-3]\d)/);
        const all = `${c3} ${c4}`;
        e.left = { date: d ? ymd(d[1]) : "", type: /추방/.test(all) ? "추방" : /탈퇴/.test(all) ? "탈퇴" : "", reason: c4 };
        e.memo = d ? c3.replace(d[1], "").replace(/추방|탈퇴/g, "").trim() : c3;
        gone.push(e);
    }
    return { current, gone };
}

async function runImport(file) {
    const status = $("#rb-status");
    status.textContent = "엑셀을 읽는 중…";
    try {
        const sheets = await readWorkbook(file);
        const byName = new Map(guildIds().map((g) => [squash(guildName(g)), g]));
        const plan = [];
        for (const s of sheets) {
            const g = byName.get(squash(s.name));
            if (!g) continue;
            const { current, gone } = parseSheet(s);
            if (current.length || gone.length) plan.push({ g, current, gone });
        }
        if (!plan.length) { status.textContent = "유니온 이름과 같은 시트를 찾지 못했습니다."; return; }
        if (!confirm(`엑셀에서 찾은 멤버 기록:\n\n${plan.map((p) => `· ${guildName(p.g)}: 지금 멤버 ${p.current.length}명, 나간 멤버 ${p.gone.length}명`).join("\n")}\n\n가져올까요? 이미 있는 기록은 빈칸만 채웁니다.`)) { status.textContent = ""; return; }
        let added = 0, filled = 0;
        for (const p of plan) {
            const book = await loadBook(p.g);
            for (const x of [...p.current, ...p.gone]) {
                const nick = x.nicks[x.nicks.length - 1];
                const e = (x.uid && book.entries.find((y) => y.uid === x.uid)) || book.entries.find((y) => (y.nicks || []).some((n) => squash(n) === squash(nick)));
                if (!e) {
                    book.entries.push({ key: newKey(), id: "", uid: "", joinDate: "", joinLevel: "", joinSynchro: "", joinCampaign: "", joinExtra: "", memo: "", left: null, ...x, src: "excel" });
                    added++;
                    continue;
                }
                // 엑셀이 원본 기록이라, 허브에서 직접 고친 기록(manual)이 아니면 엑셀 값으로 덮어씀 (직접 고친 기록은 빈칸만 채움)
                let touched = false;
                const trust = e.src !== "manual";
                if (x.order != null && e.order !== x.order) { e.order = x.order; touched = true; }
                for (const k of ["uid", "joinDate", "joinLevel", "joinSynchro", "joinCampaign", "joinExtra", "memo"]) {
                    if (x[k] && (!e[k] || (trust && e[k] !== x[k]))) { e[k] = x[k]; touched = true; }
                }
                for (const n of x.nicks) if (!(e.nicks || []).includes(n)) { e.nicks = [n, ...(e.nicks || [])]; touched = true; }
                if (x.left && (!e.left || (trust && !e.left.reason && !e.left.type))) { e.left = x.left; touched = true; }
                if (touched) filled++;
            }
            await saveBook(p.g);
        }
        status.textContent = `가져오기 완료: 새 기록 ${added}개, 빈칸 채운 기록 ${filled}개`;
        render();
    } catch (e) { status.textContent = `가져오지 못했습니다: ${e.message}`; }
}

// ---------- 시작 ----------
let initPromise = null;
export const initRoster = () => (initPromise ||= setup());
async function setup() {
    $("#rb-view").innerHTML = `<p class="empty">불러오는 중…</p>`;
    const [infoDoc, memberSnap, bookSnap, raidSnap] = await Promise.all([
        getDoc(doc(db, "union_info", "latest")), getDocs(collection(db, "union_members")), getDocs(collection(db, "union_book")), getDocs(collection(db, "union_raids")),
    ]);
    b.info = infoDoc.exists() ? JSON.parse(infoDoc.data().data) : null;
    memberSnap.forEach((d) => (b.members[d.id] = JSON.parse(d.data().data)));
    bookSnap.forEach((d) => (b.books[d.id] = JSON.parse(d.data().data)));
    raidSnap.forEach((d) => { const x = JSON.parse(d.data().data); (b.raids[x.guild] ||= []).push(x); });
    try {
        const fixed = await (await fetch("data/join-order.json")).json();
        for (const [name, list] of Object.entries(fixed)) if (!name.startsWith("_")) b.fixed[squash(name)] = list;
        b.fixedAsOf = fixed._기준일 || "";
    } catch {}
    // 예전 버전이 블라블라 값으로 잘못 넣은 UID 정리: 한 유니온에서 같은 UID가 3명 이상이면 그 UID는 비움
    for (const [g, book] of Object.entries(b.books)) {
        const count = {};
        for (const e of book.entries) if (e.uid) count[e.uid] = (count[e.uid] || 0) + 1;
        const bad = Object.keys(count).filter((k) => count[k] >= 3);
        // 같은 날 자동으로 3명 이상 "가입"한 기록도 예전 버전이 한꺼번에 만든 것이라 가입 정보를 비움 (엑셀에 있으면 가져오기로 다시 채워짐)
        const autoDay = {};
        for (const e of book.entries) if (e.src === "auto" && e.joinDate) autoDay[e.joinDate] = (autoDay[e.joinDate] || 0) + 1;
        const badDays = Object.keys(autoDay).filter((d) => autoDay[d] >= 3);
        for (const e of book.entries) if (e.src === "auto" && badDays.includes(e.joinDate)) Object.assign(e, { joinDate: "", joinLevel: "", joinSynchro: "" });
        if (bad.length) for (const e of book.entries) if (bad.includes(e.uid)) e.uid = "";
        if (bad.length || badDays.length) saveBook(g).catch(() => {});
    }
    for (const g of guildIds()) {
        b.books[g] ||= { entries: [] };
        if (applyFixed(g)) saveBook(g).catch(() => {});
    }

    $("#rb-subtabs").addEventListener("click", (e) => {
        const g = e.target.dataset.guild;
        if (!g) return;
        b.current = g;
        localStorage.setItem("hub_rb_guild", g);
        render();
    });
    $("#rb-view").addEventListener("click", (e) => {
        const id = e.target.closest("tr[data-member]")?.dataset.member;
        if (id) { const row = split(b.current).current.find((x) => x.m.id === id); return openEdit(row?.e, row?.m); }
        const key = e.target.closest("tr[data-key]")?.dataset.key;
        if (key) openEdit(b.books[b.current].entries.find((x) => x.key === key));
    });
    $("#rb-add").addEventListener("click", () => openEdit(null, null));
    $("#rb-view").addEventListener("change", (e) => {
        if (e.target.id === "rb-sort") { b.sort = e.target.value; localStorage.setItem("hub_rb_sort", b.sort); render(); }
        if (e.target.id === "rb-diff") { b.diff = e.target.value; localStorage.setItem("hub_rb_diff", b.diff); render(); }
    });
    $("#rb-import").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) runImport(f); });
    $("#rb-form").addEventListener("submit", saveEdit);
    $("#rb-delete").addEventListener("click", removeEdit);
    $("#rb-form").isLeft.addEventListener("change", (e) => {
        $("#rb-left-fields").hidden = !e.target.checked;
        if (e.target.checked && !e.target.form.leftDate.value) e.target.form.leftDate.value = today();
    });
    render();
}

// 유니온 탭이 멤버 목록을 새로 받으면 이 탭 화면도 그 목록을 씀
export function setRosterMembers(g, data) { b.members[g] = data; }
