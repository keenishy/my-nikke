import { ACCOUNTS } from "./config.js";
import { ELEMENT, ELEMENT_ICON, loadNikkeList, portraitUrl } from "./meta.js";
import { KIND, loadRaids, saveRaid, deleteRaid, newRaidId, best, fmtScore, parseScore, parsePct, buildLegacyRaids, importLegacyRaids } from "./raid-data.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ACC_COLOR = { 케니: "#4dabf7", 키니시: "#ff8787", 키니: "#51cf66", 키치: "#fcc419", 키시: "#cc5de8", 키키: "#20c997", 케니피: "#ff922b" };

const r = {
    raids: [],
    view: localStorage.getItem("hub_raid_view") || "solo",
    selected: new Set(JSON.parse(localStorage.getItem("hub_raid_selected") || "null") || ACCOUNTS),
    element: "",
    editing: null,
    chart: null,
};
const accs = () => ACCOUNTS.filter((a) => r.selected.has(a));
const saveUi = () => { localStorage.setItem("hub_raid_view", r.view); localStorage.setItem("hub_raid_selected", JSON.stringify([...r.selected])); };

function sorted(kind) {
    return r.raids.filter((x) => x.kind === kind && (!r.element || x.element === r.element))
        .sort((a, b) => kind === "solo"
            ? (b.season ?? 0) - (a.season ?? 0) || (b.start || "").localeCompare(a.start || "")
            : (b.start || "").localeCompare(a.start || ""));
}

const elIcon = (el) => (el ? `<img class="el" src="img/${ELEMENT_ICON[el]}.png" alt="${ELEMENT[el]}" title="${ELEMENT[el]}">` : "");
function pctBadge(p) {
    if (p == null) return "";
    const cls = p <= 1 ? "top1" : p <= 3 ? "top3" : p <= 5 ? "top5" : "rest";
    return `<span class="pct ${cls}">상위 ${p}%</span>`;
}
const dateRange = (x) => (x.start ? `${x.start.slice(2).replace(/-/g, ".")}${x.end ? ` ~ ${x.end.slice(5).replace(/-/g, ".")}` : ""}` : x.dateText || "날짜 없음");
const title = (x) => (x.kind === "solo" && x.season != null ? `S${x.season} ` : "") + (x.boss || "보스 미입력");

// ---------- 목록 ----------
function renderChips() {
    $("#raid-chips").innerHTML = ACCOUNTS.map((a) => `<button class="chip ${r.selected.has(a) ? "on" : ""}" data-acc="${esc(a)}">${esc(a)}</button>`).join("")
        + `<button class="chip ghost" data-acc="__all">전체</button>`;
}

function renderList() {
    const list = sorted(r.view);
    const cols = accs();
    $("#raid-count").textContent = `${list.length}회`;
    if (!list.length) { $("#raid-view").innerHTML = `<p class="empty">기록이 없습니다. 「+ 새 기록」을 누르거나 「기존 기록 가져오기」를 눌러 주세요.</p>`; return; }
    $("#raid-view").innerHTML = `<div class="table-wrap"><table class="raid-table">
        <thead><tr><th class="sticky">${r.view === "solo" ? "시즌 / 보스" : "보스"}</th>${cols.map((a) => `<th>${esc(a)}</th>`).join("")}</tr></thead>
        <tbody>${list.map((x) => `<tr data-id="${esc(x.id)}">
            <td class="sticky"><div class="rt">${elIcon(x.element)}<b>${esc(title(x))}</b></div>
                <div class="muted">${esc(dateRange(x))}${x.deck ? ` · ${esc(x.deck)}` : ""}</div>
                ${x.note ? `<div class="rnote">${esc(x.note)}</div>` : ""}</td>
            ${cols.map((a) => {
                const res = x.results?.[a];
                const b = best(res);
                if (!b) return `<td class="dim">-${res?.memo ? `<div class="rmemo" title="${esc(res.memo)}">메모</div>` : ""}</td>`;
                return `<td><b>${fmtScore(b.score)}</b>${b.runs > 1 ? `<small class="muted"> ·${b.runs}회</small>` : ""}<div>${pctBadge(b.pct)}</div>${b.deck.length ? `<div class="dks">${deckThumbs(b.deck, "tiny")}</div>` : ""}${res.memo ? `<div class="rmemo" title="${esc(res.memo)}">${esc(res.memo)}</div>` : ""}</td>`;
            }).join("")}
        </tr>`).join("")}</tbody></table></div>`;
}

// ---------- 통계 ----------
function statsFor(kind, acc) {
    const list = sorted(kind).filter((x) => best(x.results?.[acc]));
    if (!list.length) return null;
    const bests = list.map((x) => ({ x, b: best(x.results[acc]) }));
    const top = bests.reduce((m, v) => (v.b.score > m.b.score ? v : m));
    const pcts = bests.map((v) => v.b.pct).filter((p) => p != null);
    const recent = pcts.slice(0, 5);
    const avg = (a) => (a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : "-");
    return { count: list.length, top, bestPct: pcts.length ? Math.min(...pcts) : null, recent: avg(recent), all: avg(pcts) };
}

function renderStats() {
    const cols = accs();
    $("#raid-count").textContent = "";
    const table = (kind) => `<h3 class="sec">${KIND[kind]}</h3>
        <div class="table-wrap"><table class="stats"><thead><tr><th class="sticky"></th><th>참여</th><th>최고 점수</th><th>최고 순위</th><th>최근 5회 평균</th><th>전체 평균</th></tr></thead><tbody>
        ${cols.map((a) => {
            const s = statsFor(kind, a);
            if (!s) return `<tr><td class="sticky"><b>${esc(a)}</b></td><td colspan="5" class="muted">기록 없음</td></tr>`;
            return `<tr><td class="sticky"><b>${esc(a)}</b></td><td>${s.count}</td><td>${fmtScore(s.top.b.score)} <small class="muted">${esc(title(s.top.x))}</small></td>
                <td>${s.bestPct != null ? `${s.bestPct}%` : "-"}</td><td><b>상위 ${s.recent}%</b></td><td>상위 ${s.all}%</td></tr>`;
        }).join("")}</tbody></table></div>`;
    $("#raid-view").innerHTML = `${table("solo")}
        <h3 class="sec">솔로 레이드 순위 추이 (상위 %)</h3><div class="chart-box"><canvas id="raid-chart"></canvas></div>
        ${table("coop")}`;
    drawChart();
}

async function loadChartJs() {
    if (window.Chart) return;
    await new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
        s.onload = ok; s.onerror = fail;
        document.head.appendChild(s);
    });
}

async function drawChart() {
    await loadChartJs();
    Chart.defaults.color = "#8b93a7";
    Chart.defaults.borderColor = "#2a2f3d";
    const canvas = $("#raid-chart");
    if (!canvas) return;
    const list = sorted("solo").slice().reverse();
    r.chart?.destroy();
    r.chart = new Chart(canvas, {
        type: "line",
        data: {
            labels: list.map((x) => (x.season != null ? `S${x.season}` : x.boss)),
            datasets: accs().map((a) => ({
                label: a, data: list.map((x) => best(x.results?.[a])?.pct ?? null),
                borderColor: ACC_COLOR[a], backgroundColor: ACC_COLOR[a], tension: 0.3, spanGaps: true, pointRadius: 3,
            })),
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { reverse: true, title: { display: true, text: "상위 %" } } },
            plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: 상위 ${c.parsed.y}%` } } },
        },
    });
}

function render() {
    document.querySelectorAll("#raid-subtabs button").forEach((b) => b.classList.toggle("on", b.dataset.rview === r.view));
    renderChips();
    $("#raid-new").hidden = r.view === "stats";
    r.view === "stats" ? renderStats() : renderList();
}

// ---------- 입력/수정 ----------
// ---------- 덱 ----------
function deckThumbs(deck = [], size = "") {
    return deck.map((c) => r.meta?.get(c)).filter(Boolean)
        .map((m) => `<img class="dk ${size}" src="${portraitUrl(m.resource)}" alt="${esc(m.name)}" title="${esc(m.name)}">`).join("");
}
const deckButton = (deck) => (deck.length ? `<span class="dks">${deckThumbs(deck)}</span>` : "덱 선택");

// 점수는 숫자만 쳐도 쉼표가 자동으로 붙고, 아래에 "316억 6509만"처럼 읽기 쉬운 값을 같이 보여 줌
const scoreHint = (n) => (n >= 1e8 ? `${Math.floor(n / 1e8)}억${n % 1e8 >= 1e4 ? ` ${Math.floor((n % 1e8) / 1e4)}만` : ""}` : n >= 1e4 ? `${Math.floor(n / 1e4)}만` : "");

function runRow(run = {}) {
    const deck = run.deck || [];
    return `<div class="run" data-deck="${deck.join(",")}">
        <div class="score-wrap"><input class="score" inputmode="numeric" autocomplete="off" placeholder="점수 (숫자만)" value="${run.score ? run.score.toLocaleString() : ""}"><span class="score-hint">${run.score ? scoreHint(run.score) : ""}</span></div>
        <label class="pct-wrap"><span>상위</span><input class="pctin" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${run.pct ?? ""}"><span>%</span></label>
        <button type="button" class="btn small" data-delrun aria-label="회차 삭제">✕</button>
        <button type="button" class="deck-btn" data-deckedit>${deckButton(deck)}</button></div>`;
}

// 입력하는 동안 점수에 쉼표를 넣고, 커서는 같은 숫자 뒤에 그대로 둠
function formatScoreInput(el) {
    const digitsBefore = el.value.slice(0, el.selectionStart).replace(/\D/g, "").length;
    const n = parseScore(el.value);
    el.value = n ? n.toLocaleString() : "";
    let pos = 0;
    for (let seen = 0; pos < el.value.length && seen < digitsBefore; pos++) if (/\d/.test(el.value[pos])) seen++;
    el.setSelectionRange(pos, pos);
    el.parentElement.querySelector(".score-hint").textContent = scoreHint(n);
}

// 상위 %는 숫자와 소수점 하나만 남김 ("1.72%"를 붙여 넣어도 1.72)
function cleanPctInput(el) {
    const [int, ...rest] = el.value.replace(/[^0-9.]/g, "").split(".");
    const v = rest.length ? `${int}.${rest.join("")}` : int;
    if (v !== el.value) el.value = v;
}

const readDeck = (row) => (row.dataset.deck ? row.dataset.deck.split(",").map(Number) : []);

function openDeckPicker(row) {
    const acc = row.closest(".racc").dataset.acc;
    const runNo = [...row.parentElement.children].indexOf(row) + 1;
    r.picker = { row, acc, deck: readDeck(row) };
    $("#deck-title").textContent = `${acc} · ${runNo}회차 덱`;
    $("#deck-q").value = "";
    renderDeckPicker();
    $("#deck-dialog").showModal();
    $("#deck-q").focus();
}

function renderDeckPicker() {
    const { acc, deck } = r.picker;
    const owned = $("#deck-owned").checked ? new Set((JSON.parse(localStorage.getItem("hub_roster") || "{}")[acc]?.nikkes || []).map((n) => n.c)) : null;
    const q = $("#deck-q").value.replace(/\s/g, "");
    const list = [...r.meta.values()]
        .filter((m) => m.rare === "SSR" && (!owned || owned.has(m.code)) && (!q || m.name.replace(/\s/g, "").includes(q)))
        .sort((a, b) => (b.release || "").localeCompare(a.release || "") || b.order - a.order);
    $("#deck-picked").innerHTML = [0, 1, 2, 3, 4].map((i) => {
        const m = r.meta.get(deck[i]);
        return m ? `<button type="button" class="pick on" data-pick="${m.code}"><img src="${portraitUrl(m.resource)}" alt=""><span>${esc(m.name)}</span></button>`
            : `<div class="pick empty">${i + 1}</div>`;
    }).join("");
    $("#deck-grid").innerHTML = list.map((m) => `<button type="button" class="pick ${deck.includes(m.code) ? "on" : ""}" data-pick="${m.code}">
        <img loading="lazy" src="${portraitUrl(m.resource)}" alt=""><span>${esc(m.name)}</span></button>`).join("") || `<p class="muted">맞는 니케가 없습니다.</p>`;
}

function togglePick(code) {
    const { deck } = r.picker;
    const i = deck.indexOf(code);
    if (i >= 0) deck.splice(i, 1);
    else if (deck.length < 5) deck.push(code);
    renderDeckPicker();
}

function applyDeck() {
    const { row, deck } = r.picker;
    row.dataset.deck = deck.join(",");
    row.querySelector("[data-deckedit]").innerHTML = deckButton(deck);
    $("#deck-dialog").close();
}

function openEdit(raid) {
    const kind = raid?.kind || (r.view === "coop" ? "coop" : "solo");
    r.editing = raid || null;
    const f = $("#raid-form");
    f.kind.value = kind;
    f.kind.disabled = !!raid;
    f.season.value = raid?.season ?? (kind === "solo" ? (Math.max(0, ...r.raids.filter((x) => x.kind === "solo").map((x) => x.season || 0)) + 1) : "");
    f.boss.value = raid?.boss || "";
    f.bossEn.value = raid?.bossEn || "";
    f.element.value = raid?.element || "";
    f.start.value = raid?.start || "";
    f.end.value = raid?.end || "";
    f.deck.value = raid?.deck || "";
    f.note.value = raid?.note || "";
    $("#raid-accounts").innerHTML = ACCOUNTS.map((a) => {
        const res = raid?.results?.[a];
        const runs = res?.runs?.length ? res.runs : [{}];
        return `<div class="racc" data-acc="${esc(a)}"><div class="racc-head"><b>${esc(a)}</b><button type="button" class="btn small" data-addrun>+ 회차</button></div>
            <div class="runs">${runs.map(runRow).join("")}</div>
            <input class="memo" placeholder="${esc(a)} 메모" value="${esc(res?.memo || "")}"></div>`;
    }).join("");
    toggleKindFields();
    $("#raid-delete").hidden = !raid;
    $("#raid-title").textContent = raid ? "레이드 기록 수정" : "새 레이드 기록";
    $("#raid-dialog").showModal();
}

function toggleKindFields() {
    const solo = $("#raid-form").kind.value === "solo";
    document.querySelectorAll("#raid-form .solo-only").forEach((el) => (el.hidden = !solo));
    document.querySelectorAll("#raid-form .coop-only").forEach((el) => (el.hidden = solo));
}

async function submitRaid(e) {
    e.preventDefault();
    const f = e.target;
    const kind = f.kind.value;
    const results = {};
    document.querySelectorAll("#raid-accounts .racc").forEach((el) => {
        const runs = [...el.querySelectorAll(".run")].map((row) => ({ score: parseScore(row.querySelector(".score").value), pct: parsePct(row.querySelector(".pctin").value), deck: readDeck(row) }))
            .filter((x) => x.score || x.pct != null || x.deck.length);
        const memo = el.querySelector(".memo").value.trim();
        if (runs.length || memo) results[el.dataset.acc] = { runs, memo };
    });
    const season = parseInt(f.season.value);
    const raid = {
        ...(r.editing || {}),
        id: r.editing?.id || newRaidId(),
        kind, season: kind === "solo" && Number.isFinite(season) ? season : null,
        boss: f.boss.value.trim(), bossEn: kind === "solo" ? f.bossEn.value.trim() : "", element: f.element.value,
        start: f.start.value, end: f.end.value, deck: kind === "coop" ? f.deck.value.trim() : "", note: f.note.value.trim(), results,
    };
    try {
        await saveRaid(raid);
        r.raids = r.raids.filter((x) => x.id !== raid.id).concat({ ...raid, edited: true });
        $("#raid-dialog").close();
        fillBossList();
        render();
    } catch (err) { alert(`저장하지 못했습니다: ${err.message}`); }
}

async function removeRaid() {
    const raid = r.editing;
    if (!raid || !confirm(`「${title(raid)}」 기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await deleteRaid(raid.id);
    r.raids = r.raids.filter((x) => x.id !== raid.id);
    $("#raid-dialog").close();
    render();
}

// 이전에 입력한 보스 이름 → 약점·영어 표기 자동 채움
function fillBossList() {
    const seen = new Map();
    for (const x of [...r.raids].sort((a, b) => (a.start || "").localeCompare(b.start || ""))) if (x.boss) seen.set(x.boss, x);
    r.bossInfo = seen;
    $("#raid-bosses").innerHTML = [...seen.keys()].map((b) => `<option value="${esc(b)}">`).join("");
}

// ---------- 기존 기록 가져오기 ----------
async function runImport() {
    const btn = $("#raid-import");
    btn.disabled = true;
    btn.textContent = "기존 기록 읽는 중…";
    try {
        const raids = await buildLegacyRaids();
        const solo = raids.filter((x) => x.kind === "solo").length;
        if (confirm(`기존 레이드 기록부에서 솔로 레이드 ${solo}회, 협동 작전 ${raids.length - solo}회를 찾았습니다.\n\n허브로 가져올까요?\n· 기존 기록부 데이터는 그대로 남습니다.\n· 허브에서 이미 고친 기록은 덮어쓰지 않습니다.`)) {
            btn.textContent = "저장 중…";
            const res = await importLegacyRaids(raids, r.raids);
            r.raids = await loadRaids();
            fillBossList();
            render();
            alert(`가져오기 완료: ${res.written}개 저장${res.keptEdited ? `, 허브에서 고친 ${res.keptEdited}개는 유지` : ""}`);
        }
    } catch (e) { alert(`가져오지 못했습니다: ${e.message}`); }
    btn.disabled = false;
    btn.textContent = "기존 기록 가져오기";
}

// ---------- 시작 ----------
let started = false;
export async function initRaid() {
    if (started) return;
    started = true;
    $("#raid-view").innerHTML = `<p class="empty">레이드 기록을 불러오는 중…</p>`;
    [r.raids, r.meta] = await Promise.all([loadRaids(), loadNikkeList()]);
    fillBossList();

    document.querySelectorAll("#raid-subtabs button").forEach((b) => b.addEventListener("click", () => { r.view = b.dataset.rview; saveUi(); render(); }));
    $("#raid-chips").addEventListener("click", (e) => {
        const a = e.target.closest("[data-acc]")?.dataset.acc;
        if (!a) return;
        if (a === "__all") r.selected = r.selected.size === ACCOUNTS.length ? new Set([ACCOUNTS[0]]) : new Set(ACCOUNTS);
        else if (r.selected.has(a) && r.selected.size > 1) r.selected.delete(a);
        else r.selected.add(a);
        saveUi(); render();
    });
    $("#raid-element").addEventListener("change", (e) => { r.element = e.target.value; render(); });
    $("#raid-new").addEventListener("click", () => openEdit(null));
    $("#raid-import").addEventListener("click", runImport);
    $("#raid-view").addEventListener("click", (e) => {
        const id = e.target.closest("tr[data-id]")?.dataset.id;
        if (id) openEdit(r.raids.find((x) => x.id === id));
    });

    const f = $("#raid-form");
    f.addEventListener("submit", submitRaid);
    f.kind.addEventListener("change", toggleKindFields);
    f.boss.addEventListener("change", () => {
        const prev = r.bossInfo.get(f.boss.value.trim());
        if (prev) { f.element.value ||= prev.element; f.bossEn.value ||= prev.bossEn || ""; }
    });
    $("#raid-accounts").addEventListener("click", (e) => {
        if (e.target.dataset.addrun !== undefined) e.target.closest(".racc").querySelector(".runs").insertAdjacentHTML("beforeend", runRow());
        const deckBtn = e.target.closest("[data-deckedit]");
        if (deckBtn) return openDeckPicker(deckBtn.closest(".run"));
        if (e.target.dataset.delrun !== undefined) {
            const runs = e.target.closest(".runs");
            if (runs.children.length > 1) e.target.closest(".run").remove();
            else { runs.querySelectorAll("input").forEach((i) => (i.value = "")); runs.querySelector(".score-hint").textContent = ""; }
        }
    });
    $("#raid-accounts").addEventListener("input", (e) => {
        if (e.target.classList.contains("score")) formatScoreInput(e.target);
        if (e.target.classList.contains("pctin")) cleanPctInput(e.target);
    });
    $("#raid-delete").addEventListener("click", removeRaid);
    $("#deck-q").addEventListener("input", renderDeckPicker);
    $("#deck-owned").addEventListener("change", renderDeckPicker);
    $("#deck-dialog").addEventListener("click", (e) => { const c = e.target.closest("[data-pick]")?.dataset.pick; if (c) togglePick(Number(c)); });
    $("#deck-clear").addEventListener("click", () => { r.picker.deck = []; renderDeckPicker(); });
    $("#deck-ok").addEventListener("click", applyDeck);

    render();
}
