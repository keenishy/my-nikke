import { ACCOUNTS } from "./config.js";
import {
    BOSSES, CORPS, ROLES, PATCH_DATE, OFFICIAL, emptyResult, expectedOf, actualOf, excludedFromDist,
    loadDays, saveDay, buildLegacyDays, importLegacyDays, LEGACY_URL_KEY, runCountFor, gameDate, emptyRun,
} from "./intercept-data.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const CORP_CLS = { 엘리시온: "c-ely", 미실리스: "c-mis", 테트라: "c-tet", 필그림: "c-pil", 앱노멀: "c-abn" };

const t = {
    days: [],
    view: localStorage.getItem("hub_ic_view") || "list",
    month: "",          // "YYYY-MM" 또는 "" (전체)
    acc: "",            // 통계용 계정 필터
    event: "",          // "", "normal", "fb"
    editing: null,      // { date, results }
    chart: null,
};

const sortedDays = () => t.days.slice().sort((a, b) => b.date.localeCompare(a.date));
const inPeriod = (d) => !t.month || d.date.startsWith(t.month);
const dayLabel = (date) => `${date.slice(2).replace(/-/g, ".")} (${WEEK[new Date(`${date}T00:00:00`).getDay()]})`;
const gearBadge = (c, r) => (c ? `<span class="gear ${CORP_CLS[c] || ""}" title="${esc(c)} ${esc(r)}">${esc(c[0])}${esc(r?.[0] || "")}</span>` : "");

// ---------- 목록 (항상 한 달 단위) ----------
// 목록 맨 위 "N월 합계" 한 줄: 계정별 일반 모듈 합계, 풀버 모듈 합계(+), 운빨
function monthRow(list) {
    const cells = ACCOUNTS.map((a) => {
        let mod = 0, fmod = 0, exp = 0, has = false;
        for (const d of list) {
            const x = d.results?.[a];
            if (!x || excludedFromDist(x)) continue;
            has = true;
            exp += expectedOf(x, d.date);
            for (const r of x.runs) if (!r.skip) { mod += r.mod; if (x.fb) fmod += r.fmod; }
        }
        if (!has) return `<td class="dim">-</td>`;
        const luck = exp ? ((mod + fmod) / exp) * 100 : 0;
        return `<td><b class="mods">${mod}</b>${fmod ? `<div class="fmods">+${fmod}</div>` : ""}<div class="${luck >= 100 ? "good" : "bad"} small">${luck.toFixed(1)}%</div></td>`;
    }).join("");
    return `<tr class="sum-row"><td class="sticky"><b>${Number(t.month.slice(5))}월 합계</b><div class="muted">${list.length}일</div></td>${cells}</tr>`;
}

function renderList() {
    const list = sortedDays().filter(inPeriod);
    $("#ic-count").textContent = `${list.length}일`;
    if (!list.length) { $("#ic-view").innerHTML = `<p class="empty">이 달의 기록이 없습니다. 「+ 오늘 기록 입력」을 눌러 주세요.</p>`; return; }
    $("#ic-view").innerHTML = `<div class="table-wrap"><table class="ic-table">
        <thead><tr><th class="sticky">날짜</th>${ACCOUNTS.map((a) => `<th>${esc(a)}</th>`).join("")}</tr></thead>
        <tbody>${monthRow(list)}${list.map((d) => {
            const res = Object.values(d.results || {});
            const anyFb = res.some((x) => x.fb);
            const bosses = [...new Set(res.map((x) => x.boss))];
            return `<tr data-date="${d.date}">
                <td class="sticky"><b>${dayLabel(d.date)}</b>${anyFb ? ` <span class="fbtag">풀버</span>` : ""}<div class="muted">${esc(bosses.join(", "))}</div></td>
                ${ACCOUNTS.map((a) => {
                    const x = d.results?.[a];
                    if (!x) return `<td class="dim">-</td>`;
                    if (x.skip) return `<td class="dim">미참여${x.memo ? `<div class="rmemo" title="${esc(x.memo)}">${esc(x.memo)}</div>` : ""}</td>`;
                    const mods = x.runs.map((r) => (r.skip ? "×" : r.mod)).join("·");
                    const fmods = x.fb ? x.runs.map((r) => (r.skip ? "×" : r.fmod)).join("·") : "";
                    const gears = x.runs.map((r) => gearBadge(r.c, r.r) + (x.fb ? gearBadge(r.fc, r.fr) : "")).join("");
                    const odd = x.runs.some((r) => r.stage !== 9) ? `<div class="muted">${x.runs.map((r) => r.stage).join("/")}단계</div>` : "";
                    return `<td><b class="mods">${mods}</b>${fmods ? `<div class="fmods">+${fmods}</div>` : ""}${gears ? `<div>${gears}</div>` : ""}${odd}${x.memo ? `<div class="rmemo" title="${esc(x.memo)}">${esc(x.memo)}</div>` : ""}</td>`;
                }).join("")}
            </tr>`;
        }).join("")}</tbody></table></div>`;
}

// ---------- 통계 ----------
function filteredPairs() {
    const out = [];
    for (const d of t.days) {
        if (!inPeriod(d)) continue;
        for (const [a, x] of Object.entries(d.results || {})) {
            if (t.acc && a !== t.acc) continue;
            if (t.event === "normal" && x.fb) continue;
            if (t.event === "fb" && !x.fb) continue;
            out.push({ date: d.date, acc: a, x });
        }
    }
    return out;
}

function luckRow(label, pairs) {
    let exp = 0, act = 0, runs = 0;
    for (const { date, x } of pairs) {
        if (excludedFromDist(x)) continue; // 기존 사이트와 같이 미참여·"안했/못함/까먹" 메모 날은 제외
        exp += expectedOf(x, date); act += actualOf(x); runs += x.runs.filter((r) => !r.skip).length;
    }
    const luck = exp ? (act / exp) * 100 : 0;
    return `<tr><td class="sticky"><b>${esc(label)}</b></td><td>${runs}</td><td>${exp.toFixed(1)}</td><td>${act}</td>
        <td><b class="${luck >= 100 ? "good" : "bad"}">${exp ? `${luck.toFixed(1)}%` : "-"}</b></td>
        <td class="barcell"><div class="bar ${luck >= 100 ? "good" : "bad"}" style="width:${Math.min(luck, 150) / 1.5}%"></div></td></tr>`;
}

function renderStats() {
    const pairs = filteredPairs();
    $("#ic-count").textContent = "";
    const head = `<thead><tr><th class="sticky"></th><th>회차</th><th>기댓값</th><th>실제 모듈</th><th>운빨</th><th class="barcell"></th></tr></thead>`;
    const accs = t.acc ? [t.acc] : ACCOUNTS;
    const bosses = [...new Set(pairs.map((p) => p.x.boss))];

    // 장비 획득: 기업 × 부위
    const gear = {};
    for (const { x } of pairs) if (!x.skip) for (const r of x.runs) {
        if (r.skip) continue;
        if (r.c) gear[`${r.c}|${r.r}`] = (gear[`${r.c}|${r.r}`] || 0) + 1;
        if (x.fb && r.fc) gear[`${r.fc}|${r.fr}`] = (gear[`${r.fc}|${r.fr}`] || 0) + 1;
    }
    const gearTotal = Object.values(gear).reduce((s, v) => s + v, 0);

    $("#ic-view").innerHTML = `
        <h3 class="sec">계정별 운빨 <small class="muted">(실제 모듈 ÷ 기댓값)</small></h3>
        <div class="table-wrap"><table class="stats">${head}<tbody>
            ${accs.map((a) => luckRow(a, pairs.filter((p) => p.acc === a))).join("")}
            ${accs.length > 1 ? luckRow("전체", pairs) : ""}
        </tbody></table></div>
        <h3 class="sec">보스별 운빨</h3>
        <div class="table-wrap"><table class="stats">${head}<tbody>${bosses.map((b) => luckRow(b, pairs.filter((p) => p.x.boss === b))).join("")}</tbody></table></div>
        <h3 class="sec">9단계 일반 모듈 개수 분포 <small class="muted">(실제 vs 공식, 7/23 패치 전후 비율로 섞음)</small></h3>
        <div class="chart-box"><canvas id="ic-chart"></canvas></div>
        <div id="ic-dist-table"></div>
        <h3 class="sec">장비 획득 <small class="muted">(${gearTotal}개)</small></h3>
        <div class="table-wrap"><table class="stats"><thead><tr><th class="sticky"></th>${ROLES.map((r) => `<th>${r}</th>`).join("")}<th>합계</th></tr></thead><tbody>
            ${CORPS.map((c) => {
                const row = ROLES.map((r) => gear[`${c}|${r}`] || 0);
                return `<tr><td class="sticky">${gearBadge(c, "")} <b>${c}</b></td>${row.map((v) => `<td>${v}</td>`).join("")}<td><b>${row.reduce((s, v) => s + v, 0)}</b></td></tr>`;
            }).join("")}
        </tbody></table></div>`;
    drawDist(pairs);
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

async function drawDist(pairs) {
    const counts = [0, 0, 0, 0];
    let pre = 0, post = 0;
    for (const { date, x } of pairs) {
        if (excludedFromDist(x)) continue;
        for (const r of x.runs) {
            if (r.skip || r.stage !== 9) continue;
            counts[Math.min(r.mod, 3)]++;
            date >= PATCH_DATE ? post++ : pre++;
        }
    }
    const total = pre + post;
    const actual = counts.map((c) => (total ? +((c / total) * 100).toFixed(1) : 0));
    const official = OFFICIAL.pre.map((p, i) => (total ? +((pre * p + post * OFFICIAL.post[i]) / total).toFixed(1) : 0));
    $("#ic-dist-table").innerHTML = `<div class="table-wrap"><table class="stats"><thead><tr><th class="sticky"></th><th>0개</th><th>1개</th><th>2개</th><th>3개</th></tr></thead><tbody>
        <tr><td class="sticky"><b>내 기록</b></td>${counts.map((c, i) => `<td>${actual[i]}% <small class="muted">(${c})</small></td>`).join("")}</tr>
        <tr><td class="sticky">공식 확률</td>${official.map((v) => `<td>${v}%</td>`).join("")}</tr>
    </tbody></table></div><p class="muted">9단계 ${total}회차 기준 (패치 전 ${pre}, 후 ${post}). 미참여·메모에 "안했/못함/까먹"이 있는 날은 제외.</p>`;

    await loadChartJs();
    Chart.defaults.color = "#8b93a7";
    Chart.defaults.borderColor = "#2a2f3d";
    const canvas = $("#ic-chart");
    if (!canvas) return;
    t.chart?.destroy();
    t.chart = new Chart(canvas, {
        type: "bar",
        data: {
            labels: ["0개", "1개", "2개", "3개"],
            datasets: [
                { label: "내 기록 (%)", data: actual, backgroundColor: "rgba(255, 169, 77, 0.8)" },
                { label: "공식 확률 (%)", data: official, backgroundColor: "rgba(139, 147, 167, 0.4)" },
            ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}%` } } } },
    });
}

function render() {
    document.querySelectorAll("#ic-subtabs button").forEach((b) => b.classList.toggle("on", b.dataset.icview === t.view));
    $("#ic-acc").hidden = t.view !== "stats";
    $("#ic-event").hidden = t.view !== "stats";
    t.view === "stats" ? renderStats() : renderList();
}

// 기록 화면은 항상 한 달(기본: 이번 달), 통계 화면만 "전체 기간" 선택 가능
function fillMonths() {
    const thisMonth = gameDate().slice(0, 7);
    const months = [...new Set([thisMonth, ...t.days.map((d) => d.date.slice(0, 7))])].sort().reverse();
    if (t.view !== "stats" && !t.month) t.month = thisMonth;
    $("#ic-month").innerHTML = (t.view === "stats" ? `<option value="">전체 기간</option>` : "")
        + months.map((m) => `<option value="${m}">${m.replace("-", "년 ")}월</option>`).join("");
    $("#ic-month").value = t.month;
    $("#ic-prev").hidden = $("#ic-next").hidden = t.view === "stats";
}

function shiftMonth(step) {
    const opts = [...$("#ic-month").options].map((o) => o.value).filter(Boolean); // 최신 달이 앞
    const i = opts.indexOf(t.month);
    const next = opts[i - step];
    if (next) { t.month = next; fillMonths(); render(); }
}

// ---------- 입력 창 (날짜 하나 × 7계정) ----------
const opt = (list, val, blank) => (blank ? `<option value="">${blank}</option>` : "") + list.map((v) => `<option ${String(v) === String(val) ? "selected" : ""}>${v}</option>`).join("");
const gearSelect = (cls, c, r) => `<select class="${cls}">${`<option value="">장비 없음</option>` + CORPS.flatMap((cc) => ROLES.map((rr) => `<option value="${cc}|${rr}" ${cc === c && rr === r ? "selected" : ""}>${cc} ${rr}</option>`)).join("")}</select>`;
const modButtons = (cls, v) => `<div class="mods-pick ${cls}">${[0, 1, 2, 3].map((n) => `<button type="button" data-v="${n}" class="${n === v ? "on" : ""}">${n}</button>`).join("")}</div>`;

function runHtml(r, i) {
    return `<div class="ic-run" data-i="${i}">
        <div class="ic-run-head"><span>${i + 1}회차</span><select class="stage">${opt([9, 8, 7, 6], r.stage)}</select><label><input type="checkbox" class="rskip" ${r.skip ? "checked" : ""}>스킵</label></div>
        ${modButtons("mod", r.mod)}${gearSelect("gear", r.c, r.r)}
        <div class="fb-only">${modButtons("fmod", r.fmod)}${gearSelect("fgear", r.fc, r.fr)}</div>
    </div>`;
}

// 새 날짜에서 손대지 않은 계정은 저장하지 않음 (0개로 저장되면 운빨 통계가 틀어짐)
function accCard(a, x, existing) {
    return `<div class="ic-acc ${x.skip ? "skipped" : ""} ${x.fb ? "is-fb" : ""} ${existing ? "" : "untouched"}" data-acc="${esc(a)}" ${existing ? 'data-keep="1"' : ""}>
        <div class="ic-acc-head"><b>${esc(a)}</b>
            <select class="boss">${opt(BOSSES, x.boss)}</select>
            <label><input type="checkbox" class="fb" ${x.fb ? "checked" : ""}>풀버</label>
            <label><input type="checkbox" class="skip" ${x.skip ? "checked" : ""}>미참여</label>
        </div>
        <div class="ic-runs">${x.runs.map(runHtml).join("")}</div>
        <div class="ic-acc-foot"><input class="memo" placeholder="메모" value="${esc(x.memo)}">
            <button type="button" class="btn small" data-runs="-1" title="회차 빼기">− 회차</button><button type="button" class="btn small" data-runs="1" title="회차 추가">+ 회차</button></div>
    </div>`;
}

function lastBossFor(acc, date) {
    const prev = sortedDays().find((d) => d.date < date && d.results?.[acc]);
    return prev ? { boss: prev.results[acc].boss } : { boss: "크라켄" };
}

function openDay(date) {
    const day = t.days.find((d) => d.date === date);
    const results = {};
    const rosters = JSON.parse(localStorage.getItem("hub_roster") || "{}");
    for (const a of ACCOUNTS) {
        const prevBoss = lastBossFor(a, date).boss;
        // 새 기록은 도감의 싱크로 레벨로 회차 수를 정함 (10/29 이후 400·600레벨마다 +1)
        results[a] = day?.results?.[a] ? structuredClone(day.results[a]) : emptyResult(prevBoss, false, runCountFor(rosters[a]?.synchro, date));
    }
    t.editing = { date, results, isNew: !day };
    $("#ic-date").value = date;
    $("#ic-dialog-title").textContent = day ? `${dayLabel(date)} 기록 수정` : `${dayLabel(date)} 새 기록`;
    $("#ic-all-boss").innerHTML = `<option value="">계정별 그대로</option>` + BOSSES.map((b) => `<option>${b}</option>`).join("");
    $("#ic-accounts").innerHTML = ACCOUNTS.map((a) => accCard(a, results[a], !!day?.results?.[a])).join("");
    $("#ic-status").textContent = "";
    if (!$("#ic-dialog").open) $("#ic-dialog").showModal();
}

function readCards() {
    const out = {};
    document.querySelectorAll("#ic-accounts .ic-acc[data-keep]").forEach((card) => {
        const runs = [...card.querySelectorAll(".ic-run")].map((el) => {
            const [c, r] = el.querySelector(".gear").value.split("|");
            const [fc, fr] = el.querySelector(".fgear").value.split("|");
            return {
                stage: Number(el.querySelector(".stage").value), skip: el.querySelector(".rskip").checked,
                mod: Number(el.querySelector(".mod .on")?.dataset.v || 0), c: c || "", r: r || "",
                fmod: Number(el.querySelector(".fmod .on")?.dataset.v || 0), fc: fc || "", fr: fr || "",
            };
        });
        out[card.dataset.acc] = {
            boss: card.querySelector(".boss").value, fb: card.querySelector(".fb").checked,
            skip: card.querySelector(".skip").checked, memo: card.querySelector(".memo").value.trim(), runs,
        };
    });
    return out;
}

async function saveEditing() {
    const date = $("#ic-date").value;
    if (!date) return;
    const results = readCards();
    if (!Object.keys(results).length) { $("#ic-status").textContent = "입력한 계정이 없습니다."; return; }
    const exists = t.days.some((d) => d.date === date);
    if (date !== t.editing.date && exists && !confirm(`${dayLabel(date)}에 이미 기록이 있습니다. 이 내용으로 덮어쓸까요?`)) return;
    $("#ic-status").textContent = "저장 중…";
    try {
        await saveDay(date, results);
        const day = t.days.find((d) => d.date === date);
        if (day) Object.assign(day.results, results);
        else t.days.push({ id: date, date, results, edited: true });
        fillMonths();
        $("#ic-dialog").close();
        render();
    } catch (e) { $("#ic-status").textContent = `저장하지 못했습니다: ${e.message}`; }
}

// ---------- 기존 기록 가져오기 ----------
async function runImport() {
    let url = localStorage.getItem(LEGACY_URL_KEY) || "";
    url = prompt("기존 특특요 사이트의 동기화 주소(…/data.json)를 넣어 주세요.", url)?.trim();
    if (!url) return;
    localStorage.setItem(LEGACY_URL_KEY, url);
    const btn = $("#ic-import");
    btn.disabled = true;
    btn.textContent = "기존 기록 읽는 중…";
    try {
        const { days, records, skipped } = await buildLegacyDays(url);
        if (confirm(`기존 특특요 기록 ${records}건(${days.length}일)을 찾았습니다.${skipped ? ` (알 수 없는 계정 ${skipped}건 제외)` : ""}\n\n허브로 가져올까요?\n· 기존 사이트 데이터는 그대로 남습니다.\n· 허브에서 이미 고친 날짜는 덮어쓰지 않습니다.`)) {
            btn.textContent = "저장 중…";
            const r = await importLegacyDays(days, t.days);
            t.days = await loadDays();
            fillMonths();
            render();
            alert(`가져오기 완료: ${r.written}일 저장${r.keptEdited ? `, 허브에서 고친 ${r.keptEdited}일은 유지` : ""}`);
        }
    } catch (e) { alert(`가져오지 못했습니다: ${e.message}`); }
    btn.disabled = false;
    btn.textContent = "기존 기록 가져오기";
}

// ---------- 시작 ----------

// 대시보드에서 "입력하기"를 누르면 탭 준비가 끝난 뒤 오늘 입력 창을 엶
export async function openTodayEntry() {
    await initIntercept();
    openDay(gameDate());
}

let initPromise = null;
export const initIntercept = () => (initPromise ||= setup());
async function setup() {
    $("#ic-view").innerHTML = `<p class="empty">특특요 기록을 불러오는 중…</p>`;
    t.days = await loadDays();
    fillMonths();
    $("#ic-acc").innerHTML = `<option value="">계정 전체</option>` + ACCOUNTS.map((a) => `<option>${a}</option>`).join("");

    document.querySelectorAll("#ic-subtabs button").forEach((b) => b.addEventListener("click", () => {
        t.view = b.dataset.icview;
        localStorage.setItem("hub_ic_view", t.view);
        fillMonths();
        render();
    }));
    $("#ic-month").addEventListener("change", (e) => { t.month = e.target.value; render(); });
    $("#ic-prev").addEventListener("click", () => shiftMonth(-1));
    $("#ic-next").addEventListener("click", () => shiftMonth(1));
    $("#ic-acc").addEventListener("change", (e) => { t.acc = e.target.value; render(); });
    $("#ic-event").addEventListener("change", (e) => { t.event = e.target.value; render(); });
    $("#ic-new").addEventListener("click", () => openDay(gameDate()));
    $("#ic-import").addEventListener("click", runImport);
    $("#ic-view").addEventListener("click", (e) => { const d = e.target.closest("tr[data-date]")?.dataset.date; if (d) openDay(d); });

    $("#ic-date").addEventListener("change", (e) => { if (e.target.value) openDay(e.target.value); });
    $("#ic-all-boss").addEventListener("change", (e) => { if (e.target.value) document.querySelectorAll("#ic-accounts .boss").forEach((s) => (s.value = e.target.value)); });
    $("#ic-all-fb").addEventListener("click", () => {
        const boxes = [...document.querySelectorAll("#ic-accounts .fb")];
        const on = !boxes.every((b) => b.checked);
        boxes.forEach((b) => {
            const card = b.closest(".ic-acc");
            b.checked = on;
            card.classList.toggle("is-fb", on);
            card.dataset.keep = "1";
            card.classList.remove("untouched");
        });
    });
    // 카드 안을 건드리면 그 계정은 저장 대상
    const touch = (e) => { const card = e.target.closest(".ic-acc"); if (card) { card.dataset.keep = "1"; card.classList.remove("untouched"); } };
    $("#ic-accounts").addEventListener("input", touch);
    $("#ic-accounts").addEventListener("click", (e) => { if (e.target.closest("button, input, select")) touch(e); });
    $("#ic-all-boss").addEventListener("change", () => document.querySelectorAll("#ic-accounts .ic-acc").forEach((c) => { c.dataset.keep = "1"; c.classList.remove("untouched"); }));
    // 미참여로 저장된 계정도 회차 칸은 항상 누를 수 있게 두고, 회차를 건드리면 미참여를 자동으로 풂
    const unskip = (e) => {
        const card = e.target.closest(".ic-acc.skipped");
        if (!card || !e.target.closest(".ic-runs")) return;
        card.querySelector(".skip").checked = false;
        card.classList.remove("skipped");
    };
    $("#ic-accounts").addEventListener("click", (e) => { if (e.target.closest("button, input, select")) unskip(e); });
    $("#ic-accounts").addEventListener("change", unskip);
    $("#ic-accounts").addEventListener("click", (e) => {
        const b = e.target.closest(".mods-pick button");
        if (b) { b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }
        const step = e.target.closest("[data-runs]")?.dataset.runs;
        if (step) {
            const runs = e.target.closest(".ic-acc").querySelector(".ic-runs");
            if (step === "1") runs.insertAdjacentHTML("beforeend", runHtml(emptyRun(), runs.children.length));
            else if (runs.children.length > 1) runs.lastElementChild.remove();
        }
    });
    $("#ic-accounts").addEventListener("change", (e) => {
        const card = e.target.closest(".ic-acc");
        if (e.target.classList.contains("fb")) card.classList.toggle("is-fb", e.target.checked);
        if (e.target.classList.contains("skip")) card.classList.toggle("skipped", e.target.checked);
    });
    $("#ic-save").addEventListener("click", saveEditing);

    render();
}
