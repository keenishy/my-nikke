import { ACCOUNTS } from "./config.js";
import { loadNikkeList, loadCubeNames, cubeName, portraitUrl, loadRoleData, loadEnglishNames, ELEMENT, ELEMENT_ICON, CLASS, BURST, CORP, WEAPON, OPTION, OPTION_SHORT,
    nikkeIcons, rareClass, optionBadge, favoriteInfo, OPTION_BADGE, RECYCLE, RECYCLE_BY_CLASS, RECYCLE_BY_CORP } from "./meta.js";
import { loadRosters, saveRoster, db } from "./store.js";
import { doc, getDoc, getDocs, setDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { fetchAccount, checkWorker, getAccessKey, setAccessKey } from "./sync.js";
import { loadReleaseDates, loadBanners } from "./gacha-data.js";

// 출시일: 출시일 목록 파일 + 가챠 기록의 (복각이 아닌) 배너 시작일 중 가장 이른 날짜
async function loadReleaseMap(meta) {
    const [list, banners] = await Promise.all([loadReleaseDates(), loadBanners().catch(() => [])]);
    const byName = new Map(list);
    for (const b of banners) {
        if (!b.start || /복각/.test(b.type || "")) continue;
        const key = b.name.replace(/\s/g, "");
        if (!byName.has(key) || b.start < byName.get(key)) byName.set(key, b.start);
    }
    const keys = [...byName.keys()];
    for (const m of meta.values()) {
        const name = m.name.replace(/\s/g, "");
        m.release = byName.get(name) || "";
        // "유키코" ↔ "아마기유키코"처럼 표기가 조금 다른 경우는 포함 관계로 찾음
        if (!m.release && name.length >= 3) {
            // 단, 기본 니케가 "스노우 화이트 : 이노센트 데이즈" 같은 다른 버전 날짜를 가져가지 않도록 ":" 있는 이름은 제외
            const dates = keys.filter((k) => (name.includes(":") || !k.includes(":")) && (k.includes(name) || (k.length >= 3 && name.includes(k))))
                .map((k) => byName.get(k)).sort();
            m.release = dates[0] || "";
        }
    }
}

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
    meta: null,          // Map name_code → 니케 정보
    rosters: {},         // 계정 → { nikkes, opts, fetched_at, synchro }
    byAcc: {},           // 계정 → Map name_code → 육성 기록
    selected: new Set(JSON.parse(localStorage.getItem("hub_selected") || "null") || ACCOUNTS),
    view: localStorage.getItem("hub_view") || "nikke",
    focus: localStorage.getItem("hub_focus") || ACCOUNTS[0],
    q: "", rare: "SSR", element: "", cls: "", burst: "", corp: "", own: "", sort: "order",
};
const RARE_RANK = { SSR: 0, SR: 1, R: 2 };

const selectedAccounts = () => ACCOUNTS.filter((a) => state.selected.has(a));
const saveUi = () => {
    localStorage.setItem("hub_selected", JSON.stringify([...state.selected]));
    localStorage.setItem("hub_view", state.view);
    localStorage.setItem("hub_focus", state.focus);
};

function indexRosters() {
    state.byAcc = {};
    for (const [acc, r] of Object.entries(state.rosters)) state.byAcc[acc] = new Map(r.nikkes.map((n) => [n.c, n]));
}

// ---------- 표시 형식 ----------
function limitBadge(rec, rare) {
    if (!rec) return `<span class="lb none">미보유</span>`;
    if (rare === "SSR" && rec.k >= 7) return `<span class="lb max">풀코</span>`;
    if (rec.k > 0) return `<span class="lb core">${rec.k}코강</span>`;
    return `<span class="lb star">${rec.g}돌</span>`;
}
const skills = (rec) => (rec ? rec.s.join("/") : "");
// favorite_item_tid: 100xxx = 소장품(Lv 0~15), 200xxx = 전용 애장품(lv 0/1/2 = 1/2/3단계)
const favLabel = (fav) => { const f = favoriteInfo(fav); return f ? `<b class="${rareClass(f.rare)}">${f.text}</b>` : `소장품 <b>-</b>`; };

function optionTotals(rec, opts) {
    const sum = {};
    for (const [, , ids] of rec.eq) for (const id of ids) {
        const o = opts[id];
        if (o) sum[o[0]] = (sum[o[0]] || 0) + Math.abs(o[1]);
    }
    return Object.keys(OPTION_BADGE).filter((t) => sum[t]).map((t) => ({ t, v: sum[t] / 100 }));
}
const fmtPct = (v) => `${v.toFixed(2).replace(/\.?0+$/, "")}%`;

function nikkeTags(m) {
    return `<span class="tags"><b class="${rareClass(m.rare)}">${m.rare || ""}</b>${nikkeIcons(m)}</span>`;
}

// ---------- 필터 ----------
function filteredNikkes() {
    const accs = selectedAccounts();
    const q = state.q.trim();
    let list = [...state.meta.values()].filter((m) => {
        if (q && !m.name.includes(q)) return false;
        if (state.rare && m.rare !== state.rare) return false;
        if (state.element && m.element !== state.element) return false;
        if (state.cls && m.cls !== state.cls) return false;
        if (state.burst && m.burst !== state.burst) return false;
        if (state.corp && m.corp !== state.corp) return false;
        const owned = accs.filter((a) => state.byAcc[a]?.has(m.code)).length;
        if (state.own === "any" && owned === 0) return false;
        if (state.own === "missing" && (owned === 0 || owned === accs.length)) return false;
        if (state.own === "none" && owned > 0) return false;
        return true;
    });
    const byRare = (a, b) => RARE_RANK[a.rare] - RARE_RANK[b.rare];
    const cpAccs = state.view === "account" ? [state.focus] : accs;
    const cp = (m) => Math.max(0, ...cpAccs.map((a) => state.byAcc[a]?.get(m.code)?.cp || 0));
    if (state.sort === "cp") list.sort((a, b) => cp(b) - cp(a) || byRare(a, b));
    else if (state.sort === "name") list.sort((a, b) => byRare(a, b) || a.name.localeCompare(b.name, "ko"));
    else if (state.sort === "owned") {
        const cnt = (m) => accs.filter((a) => state.byAcc[a]?.has(m.code)).length;
        list.sort((a, b) => cnt(b) - cnt(a) || byRare(a, b) || b.order - a.order);
    } else if (state.sort === "old") list.sort((a, b) => byRare(a, b) || (a.release || "9").localeCompare(b.release || "9") || a.order - b.order);
    else list.sort((a, b) => byRare(a, b) || (b.release || "").localeCompare(a.release || "") || b.order - a.order);
    return list;
}

// ---------- 화면 ----------
function renderChips() {
    const multi = state.view === "nikke";
    $("#acc-chips").innerHTML = ACCOUNTS.map((a) => {
        const on = multi ? state.selected.has(a) : state.focus === a;
        const r = state.rosters[a];
        return `<button class="chip ${on ? "on" : ""}" data-acc="${esc(a)}">${esc(a)}${r ? `<small>${r.nikkes.length}</small>` : `<small>-</small>`}</button>`;
    }).join("") + (multi ? `<button class="chip ghost" data-acc="__all">전체</button>` : "");
}

function renderMatrix() {
    const accs = selectedAccounts();
    const list = filteredNikkes();
    $("#result-count").textContent = `${list.length}명`;
    if (!accs.length) { $("#view").innerHTML = `<p class="empty">계정을 하나 이상 골라 주세요.</p>`; return; }
    $("#view").innerHTML = `<div class="table-wrap"><table class="matrix">
        <thead><tr><th class="sticky">니케</th>${accs.map((a) => `<th>${esc(a)}</th>`).join("")}</tr></thead>
        <tbody>${list.map((m) => `<tr data-code="${m.code}">
            <td class="sticky"><div class="nk"><img loading="lazy" src="${portraitUrl(m.resource)}" alt=""><div><b>${esc(m.name)}</b>${nikkeTags(m)}</div></div></td>
            ${accs.map((a) => { const r = state.byAcc[a]?.get(m.code); return `<td class="${r ? "" : "dim"}">${limitBadge(r, m.rare)}<div class="sk">${skills(r)}</div></td>`; }).join("")}
        </tr>`).join("")}</tbody></table></div>`;
}

function renderAccountView() {
    const acc = state.focus;
    const roster = state.rosters[acc];
    if (!roster) { $("#view").innerHTML = `<p class="empty">${esc(acc)} 계정 데이터가 아직 없습니다. 위의 「전체 갱신」을 눌러 주세요.</p>`; return; }
    const map = state.byAcc[acc];
    const list = filteredNikkes().filter((m) => map.has(m.code));
    $("#result-count").textContent = `${list.length}명`;
    const rc = roster.recycle || {};
    const recycle = RECYCLE.filter(([id]) => rc[id] != null).map(([id, name]) => `<span>${name} <b>${rc[id]}</b></span>`).join("");
    $("#view").innerHTML = `<div class="acc-summary">
        <div>싱크로 <b>${roster.synchro ?? "-"}</b> · 보유 <b>${roster.nikkes.length}</b> · ${new Date(roster.fetched_at).toLocaleString("ko-KR")} 기준</div>
        <div class="recycle">리사이클 연구 ${recycle || `<span class="muted">— 「전체 갱신」을 한 번 누르면 표시됩니다</span>`}</div>
    </div>
    <div class="cards big">${list.map((m) => {
        const r = map.get(m.code);
        const fav = favoriteInfo(r.fav);
        const parts = r.eq.map(([tier, lv]) => (tier ? `<span class="${tier < 10 ? "t9" : ""}" title="T${tier}">${lv}</span>` : `<span class="t9">-</span>`)).join("");
        return `<div class="ncard" data-code="${m.code}">
            <div class="nc-head"><img loading="lazy" src="${portraitUrl(m.resource)}" alt="">
                <div class="grow"><b class="nc-name">${esc(m.name)}</b>
                    <div class="nc-icons">${nikkeIcons(m)}<span class="heart" title="호감도">♥ ${r.a}</span></div></div>
                ${limitBadge(r, m.rare)}</div>
            <div class="nc-row"><span class="muted">소장품</span>${fav ? `<b class="${rareClass(fav.rare)}">${fav.text}</b>` : `<span class="muted">-</span>`}
                <span class="muted">스킬</span><b>${skills(r)}</b><span class="muted">장비</span><span class="nc-eq">${parts}</span></div>
            <div class="nc-opts">${optionTotals(r, roster.opts).map((o) => optionBadge(o.t, o.v)).join("") || `<span class="muted">오버로드 옵션 없음</span>`}</div>
            <div class="nc-foot"><span class="muted">전투력</span><b>${(r.cp || 0).toLocaleString()}</b><span class="muted">Lv ${r.lv}</span></div>
        </div>`;
    }).join("")}</div>`;
}

function render() {
    if (!state.meta) return;
    renderChips();
    document.querySelectorAll(".view-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
    state.view === "nikke" ? renderMatrix() : renderAccountView();
    const times = Object.values(state.rosters).map((r) => r.fetched_at).sort();
    $("#last-sync").textContent = times.length ? `마지막 갱신 ${new Date(times[times.length - 1]).toLocaleString("ko-KR")}` : "아직 받은 데이터가 없습니다";
}

// ---------- 상세 비교 ----------
function equipCell([tier, lv, ids], opts) {
    if (!tier) return `<div class="eq none">-</div>`;
    const lines = ids.map((id) => { const o = opts[id]; return o ? `<div>${OPTION[o[0]] || o[0]} <b>${fmtPct(Math.abs(o[1]) / 100)}</b></div>` : ""; }).join("");
    return `<div class="eq"><span class="tier">T${tier}${lv ? ` +${lv}` : ""}</span>${lines || `<div class="muted">옵션 없음</div>`}</div>`;
}

// 이 니케에 적용되는 리사이클 연구 (클래스·기업)
function recycleFor(acc, m) {
    const rc = state.rosters[acc]?.recycle;
    if (!rc) return "";
    const cls = rc[RECYCLE_BY_CLASS[m.cls]], corp = rc[RECYCLE_BY_CORP[m.corp]];
    return `<span>리사이클 <b>${CLASS[m.cls]} ${cls ?? "-"} · ${CORP[m.corp]} ${corp ?? "-"}</b></span>`;
}

// ---------- 니케 기본 정보 (블라블라 데이터 + 직접 고친 값) ----------
// nikke_notes/{name_code}: { story, squad, english, release, memo } — 비어 있으면 블라블라 값을 그대로 씀
const NOTE_FIELDS = [["squad", "스쿼드"], ["english", "영어 이름"], ["release", "출시일"], ["story", "이벤트 스토리"], ["memo", "메모"]];
const noteCache = new Map();
async function loadNote(code) {
    if (!noteCache.has(code)) noteCache.set(code, getDoc(doc(db, "nikke_notes", String(code))).then((d) => (d.exists() ? d.data() : {})).catch(() => ({})));
    return noteCache.get(code);
}

// 시작할 때 전부 읽어서 직접 고친 출시일을 정렬에 반영
async function loadAllNotes(meta) {
    try {
        const snap = await getDocs(collection(db, "nikke_notes"));
        snap.forEach((d) => noteCache.set(Number(d.id), Promise.resolve(d.data())));
        snap.forEach((d) => { const m = meta.get(Number(d.id)); if (m && d.data().release) m.release = d.data().release; });
    } catch {}
}

function infoCard(m, role, english, note, editing) {
    const cv = (k) => (role?.[k] || "").replace(/^CV\s*:\s*/, "");
    const auto = { squad: role?.squad_detail?.squad_name || "", english, release: m.releaseAuto || "", story: "", memo: "" };
    const val = (k) => note?.[k] || auto[k];
    const mark = (k) => (note?.[k] ? ` <span class="edited" title="직접 고친 값 (블라블라: ${esc(auto[k] || "없음")})">✎</span>` : "");
    const items = [
        ["등급", esc(m.rare)], ["속성", esc(ELEMENT[m.element])], ["버스트", esc(BURST[m.burst])], ["클래스", esc(CLASS[m.cls])],
        ["무기", esc(m.weapon ? `${WEAPON[m.weapon] || m.weapon} (${m.weapon})` : "")], ["기업", esc(CORP[m.corp])],
        ["스쿼드", esc(val("squad")) + mark("squad")], ["영어 이름", esc(val("english")) + mark("english")],
        ["출시일", esc(val("release") ? val("release").replace(/-/g, ".") : "모름") + mark("release")],
        ["성우", esc([cv("cv_localkey_ko") && `한 ${cv("cv_localkey_ko")}`, cv("cv_localkey_ja") && `일 ${cv("cv_localkey_ja")}`].filter(Boolean).join(" · "))],
        ["이벤트 스토리", esc(val("story")) + mark("story")],
    ];
    const view = `<div class="info-grid">${items.map(([k, v]) => `<div><span class="muted">${k}</span><b>${v || "-"}</b></div>`).join("")}</div>
        ${role?.description_localkey ? `<p class="info-desc">${esc(role.description_localkey)}</p>` : ""}
        ${note?.memo ? `<p class="info-memo">📝 ${esc(note.memo)}</p>` : ""}`;
    const form = `<div class="info-form">${NOTE_FIELDS.map(([k, label]) => `<label><span class="muted">${label}</span>
            <input data-note="${k}" ${k === "release" ? 'type="date"' : ""} value="${esc(note?.[k] || "")}" placeholder="${esc(auto[k] || (k === "memo" ? "자유 메모" : "비워 두면 블라블라 값"))}"></label>`).join("")}</div>
        <p class="muted">비워 둔 칸은 블라블라 값을 그대로 씁니다.</p>`;
    return `<div class="info-card" data-code="${m.code}">
        <div class="info-top"><b>니케 정보</b><span class="muted" id="note-status"></span>
            ${editing
                ? `<button class="btn small" data-note-cancel>취소</button><button class="btn small" data-note-reset>원래대로</button><button class="btn primary small" data-note-save>저장</button>`
                : `<button class="btn small" data-note-edit>정보 수정</button>`}</div>
        ${editing ? form : view}
    </div>`;
}

async function saveNote(code, clear = false) {
    const data = {};
    for (const [k] of NOTE_FIELDS) data[k] = clear ? "" : (document.querySelector(`.info-form [data-note="${k}"]`)?.value || "").trim();
    $("#note-status").textContent = "저장 중…";
    try {
        await setDoc(doc(db, "nikke_notes", String(code)), data);
        noteCache.set(code, Promise.resolve(data));
        const m = state.meta.get(code);
        m.release = data.release || m.releaseAuto || "";
        state.editingInfo = false;
        await openDetail(code, state.lastCompareAll);
        render();
    } catch (e) { $("#note-status").textContent = `실패: ${e.message}`; }
}

// 니케 보기: 고른 계정들 비교 / 계정 보기: 그 계정만 (버튼으로 전체 비교 전환)
async function openDetail(code, compareAll = false) {
    state.lastCompareAll = compareAll;
    const m = state.meta.get(code);
    const single = state.view === "account" && !compareAll;
    const accs = state.view === "nikke" ? selectedAccounts() : compareAll ? ACCOUNTS : [state.focus];
    const rows = accs.map((a) => ({ a, r: state.byAcc[a]?.get(code), opts: state.rosters[a]?.opts || {} }));
    const [role, englishMap, note] = await Promise.all([
        loadRoleData(m.resource), loadEnglishNames(), loadNote(code),
        loadCubeNames(rows.flatMap(({ r }) => (r ? [r.cube[0], r.acube[0]] : []))),
    ]);
    const english = englishMap.get(code) || "";
    $("#detail-body").innerHTML = `
        <div class="dhead"><img src="${portraitUrl(m.resource)}" alt=""><div class="grow"><h2>${esc(m.name)}</h2>${nikkeTags(m)}</div>
            ${state.view === "account" ? `<button class="btn" data-compare="${single ? 1 : 0}" data-code="${code}">${single ? "7계정 전체 비교" : `${esc(state.focus)}만 보기`}</button>` : ""}</div>
        ${infoCard(m, role, english, note, state.editingInfo)}
        ${rows.map(({ a, r, opts }) => !r ? `<div class="drow dim"><div class="dacc">${esc(a)}</div><div class="muted">미보유</div></div>` : `
        <div class="drow">
            <div class="dacc">${esc(a)} ${limitBadge(r, m.rare)}</div>
            <div class="dstats">
                <span>Lv <b>${r.lv}</b></span><span>스킬 <b>${skills(r)}</b></span><span>호감도 <b>${r.a}</b></span>
                <span>큐브 <b>${esc(cubeName(r.cube[0]))}${r.cube[0] ? ` Lv${r.cube[1]}` : ""}</b></span>
                ${r.acube[0] && r.acube[0] !== r.cube[0] ? `<span>아레나 큐브 <b>${esc(cubeName(r.acube[0]))} Lv${r.acube[1]}</b></span>` : ""}
                <span>${favLabel(r.fav)}</span>
                <span>전투력 <b>${(r.cp || 0).toLocaleString()}</b></span>
                ${recycleFor(a, m)}
            </div>
            <div class="eqs">${["머리", "몸", "팔", "다리"].map((p, i) => `<div><div class="part">${p}</div>${equipCell(r.eq[i], opts)}</div>`).join("")}</div>
            <div class="nc-opts">${optionTotals(r, opts).map((o) => optionBadge(o.t, o.v, true)).join("") || `<span class="muted">오버로드 옵션 없음</span>`}</div>
        </div>`).join("")}`;
    if (!$("#detail").open) $("#detail").showModal();
}

// ---------- 갱신 ----------
async function syncAll() {
    if (!getAccessKey()) { openSettings(); return; }
    const btn = $("#sync-btn");
    btn.disabled = true;
    const failed = [];
    for (const [i, acc] of ACCOUNTS.entries()) {
        btn.textContent = `갱신 중 ${i + 1}/${ACCOUNTS.length} (${acc})`;
        try {
            const roster = await fetchAccount(acc);
            state.rosters[acc] = roster;
            indexRosters();
            render();
            await saveRoster(roster).catch((e) => { console.warn(e); failed.push(`${acc}: 클라우드 저장 실패 (이 브라우저에는 저장됨)`); });
        } catch (e) {
            failed.push(`${acc}: ${e.message}`);
            if (/쿠키|key/.test(e.message)) break; // 모든 계정이 같은 이유로 실패하므로 중단
        }
    }
    btn.disabled = false;
    btn.textContent = "전체 갱신";
    if (failed.length) alert(`일부 계정 갱신에 문제가 있었습니다.\n\n${failed.join("\n")}`);
}

function openSettings() {
    $("#key-input").value = getAccessKey();
    $("#key-status").textContent = "";
    $("#settings").showModal();
}

async function testKey() {
    setAccessKey($("#key-input").value);
    $("#key-status").textContent = "확인 중…";
    try {
        const r = await checkWorker();
        $("#key-status").textContent = r.cookie === "ok" ? `연결 정상 · 블라블라 쿠키 정상 · 계정 ${r.accounts.length}개` : `연결은 됐지만 블라블라 쿠키가 ${r.cookie}입니다. Cloudflare의 BLA_COOKIE를 새로 넣어 주세요.`;
    } catch (e) { $("#key-status").textContent = `실패: ${e.message}`; }
}

// ---------- 시작 ----------
export async function initCollection() {
    $("#view").innerHTML = `<p class="empty">니케 정보를 불러오는 중…</p>`;
    const [meta, { rosters, cloudOk }] = await Promise.all([loadNikkeList(), loadRosters()]);
    await loadReleaseMap(meta);
    for (const m of meta.values()) m.releaseAuto = m.release;
    await loadAllNotes(meta);
    state.meta = meta;
    state.rosters = rosters;
    indexRosters();
    if (!cloudOk) $("#cloud-warn").hidden = false;

    $("#acc-chips").addEventListener("click", (e) => {
        const acc = e.target.closest("[data-acc]")?.dataset.acc;
        if (!acc) return;
        if (state.view === "account") state.focus = acc;
        else if (acc === "__all") state.selected = state.selected.size === ACCOUNTS.length ? new Set() : new Set(ACCOUNTS);
        else state.selected.has(acc) ? state.selected.delete(acc) : state.selected.add(acc);
        saveUi(); render();
    });
    document.querySelectorAll(".view-toggle button").forEach((b) => b.addEventListener("click", () => { state.view = b.dataset.view; saveUi(); render(); }));
    for (const id of ["rare", "element", "cls", "burst", "corp", "own", "sort"]) $(`#f-${id}`).addEventListener("change", (e) => { state[id] = e.target.value; render(); });
    $("#f-q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
    $("#view").addEventListener("click", (e) => { const c = e.target.closest("[data-code]")?.dataset.code; if (c) { state.editingInfo = false; openDetail(Number(c)); } });
    $("#detail-body").addEventListener("click", (e) => {
        const b = e.target.closest("[data-compare]");
        if (b) openDetail(Number(b.dataset.code), b.dataset.compare === "1");
        const card = e.target.closest(".info-card");
        if (card) {
            const code = Number(card.dataset.code);
            if (e.target.closest("[data-note-edit]")) { state.editingInfo = true; openDetail(code, state.lastCompareAll); }
            if (e.target.closest("[data-note-cancel]")) { state.editingInfo = false; openDetail(code, state.lastCompareAll); }
            if (e.target.closest("[data-note-save]")) saveNote(code);
            if (e.target.closest("[data-note-reset]") && confirm("직접 고친 값을 모두 지우고 블라블라 값으로 되돌릴까요?")) saveNote(code, true);
        }
    });
    $("#sync-btn").addEventListener("click", syncAll);
    $("#settings-btn").addEventListener("click", openSettings);
    $("#key-test").addEventListener("click", testKey);
    // 바깥(어두운 배경)을 누르거나 ✕를 누를 때만 닫힘 — 창 안쪽 여백을 눌러도 입력이 날아가지 않게
    document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => {
        const r = d.getBoundingClientRect();
        const outside = e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
        if (outside || e.target.closest("[data-close]")) d.close();
    }));

    render();
    if (!getAccessKey()) openSettings();
}
