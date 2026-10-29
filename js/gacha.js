import { ACCOUNTS } from "./config.js";
import { loadNikkeList, portraitUrl, loadRoleData, nikkeIcons, rareClass, ELEMENT, ELEMENT_ICON } from "./meta.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./store.js";
import { gameDate } from "./intercept-data.js";

// 배너 상단에 스쿼드·이벤트 스토리(도감 상세에서 입력한 것)를 나중에 채움
async function fillBannerExtra(n) {
    const [role, note] = await Promise.all([
        loadRoleData(n.resource),
        getDoc(doc(db, "nikke_notes", String(n.code))).then((d) => (d.exists() ? d.data() : {})).catch(() => ({})),
    ]);
    const el = document.getElementById("banner-extra");
    if (!el) return;
    el.textContent = [role?.squad_detail?.squad_name && `스쿼드 ${role.squad_detail.squad_name}`, note.story && `스토리 ${note.story}`].filter(Boolean).join(" · ");
}
import {
    DROP, BLANK, BANNER_TYPES, typeCategory, parseStart, parseEnd, dailyDates, isActiveDaily, accountSummary,
    loadBanners, saveBannerInfo, saveSlot, deleteBanner, newBannerId,
    buildLegacyBanners, importLegacy, loadReleaseDates,
} from "./gacha-data.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const squash = (s) => String(s || "").replace(/\s/g, "");

const g = {
    banners: [],
    meta: null,            // name_code → 니케
    metaByName: new Map(), // 공백 뺀 이름 → 니케
    view: "list",
    q: "", cat: "", year: "",
    open: null,            // 열려 있는 배너
    rows: 0,               // 입력표에 보이는 줄 수
    slot: null,            // 편집 중인 칸 { banner, account, key, data }
};

const sortBanners = () => g.banners.sort((a, b) => (b.start || "0").localeCompare(a.start || "0") || a.name.localeCompare(b.name, "ko"));
const nikkeOf = (b) => g.metaByName.get(squash(b.name).replace(/무료1뽑$/, ""));

const elementOf = (b) => b.element || nikkeOf(b)?.element || "";

const md = (d) => d.slice(5).replace("-", "/");
const BLANK_SLOT = () => ({ d: [], b: "blank", m: "" });

function elementIcon(el) {
    return el ? `<img class="el" src="img/${ELEMENT_ICON[el]}.png" alt="${ELEMENT[el]}" title="${ELEMENT[el]}">` : "";
}

// ---------- 배너 목록 ----------
function filtered() {
    return g.banners.filter((b) =>
        (!g.q || squash(b.name).includes(squash(g.q))) &&
        (!g.cat || typeCategory(b.type) === g.cat) &&
        (!g.year || (b.start || "").startsWith(g.year)));
}

// 오늘 진행 중인 매일 무료 1뽑을 한 표에서: 줄 = 배너, 열 = 계정
function todayDailyHtml() {
    const today = gameDate();
    const active = g.banners.filter((b) => isActiveDaily(b, today));
    if (!active.length) return "";
    const done = active.reduce((t, b) => t + ACCOUNTS.filter((a) => b.results?.[a]?.[today]).length, 0);
    return `<section class="daily-today">
        <h3 class="sec">오늘 무료 1뽑 <small class="muted">${md(today)} · 05시 기준 · ${done}/${active.length * ACCOUNTS.length}</small></h3>
        <div class="table-wrap"><table class="pulls daily">
            <thead><tr><th class="sticky">배너</th>${ACCOUNTS.map((a) => `<th>${esc(a)}</th>`).join("")}</tr></thead>
            <tbody>${active.map((b) => `<tr><td class="sticky"><button class="linkish" data-open="${esc(b.id)}">${elementIcon(elementOf(b))}${esc(b.name)}</button>${b.end ? `<div class="muted">~${md(b.end)}</div>` : ""}</td>${ACCOUNTS.map((a) => {
                const slot = b.results?.[a]?.[today];
                return slot ? `<td class="slot ${slot.b ? "is-blank" : ""}" data-bid="${esc(b.id)}" data-acc="${esc(a)}" data-key="${today}">${slotHtml(slot)}</td>`
                    : `<td class="daily-todo"><button class="btn small" data-quick="blank" data-bid="${esc(b.id)}" data-acc="${esc(a)}">꽝</button><button class="btn small drop-btn pickup" data-quick="ssr" data-bid="${esc(b.id)}" data-acc="${esc(a)}">SSR</button></td>`;
            }).join("")}</tr>`).join("")}</tbody>
        </table></div>
    </section>`;
}

function renderList() {
    const list = filtered();
    $("#gacha-count").textContent = `${list.length}개 배너`;
    const firstUndated = list.findIndex((b) => !b.start);
    $("#gacha-view").innerHTML = todayDailyHtml() + (list.length ? `<div class="banner-list">${list.map((b, i) => {
        const n = nikkeOf(b);
        const divider = i === firstUndated ? `<div class="banner-divider">날짜 없는 배너 — 배너를 열고 「정보 수정」에서 시작일을 넣으면 제자리로 정렬됩니다</div>` : "";
        return `${divider}<div class="banner-row" data-id="${esc(b.id)}">
            <div class="bthumb">${n ? `<img loading="lazy" src="${portraitUrl(n.resource)}" alt="">` : `<span class="newtag">NEW</span>`}</div>
            <div class="binfo">
                <div class="bname">${elementIcon(elementOf(b))}<b>${esc(b.name)}</b></div>
                <div class="muted">${esc(b.type || "출시 타입 없음")} · ${b.start || "날짜 없음"}${b.daily && b.end ? `~${b.end}` : ""}${n || b.daily || /무료\s*1뽑/.test(b.name) ? "" : " · 블라블라 업데이트 대기"}</div>
            </div>
            <div class="bacc">${ACCOUNTS.map((a) => {
                const slots = b.results?.[a];
                if (!slots || !Object.keys(slots).length) return `<span class="bchip none" title="${esc(a)}">${esc(a)} -</span>`;
                const s = accountSummary(slots, b.daily);
                return `<span class="bchip ${s.pickup ? "hit" : "miss"}" title="${esc(a)}: ${s.pulls}${b.daily ? "회" : "연"} · 픽업 ${s.pickup}">${esc(a)} <b>${s.pulls}</b>${s.pickup ? `<i>★${s.pickup}</i>` : ""}</span>`;
            }).join("")}</div>
        </div>`;
    }).join("")}</div>` : `<p class="empty">배너가 없습니다. 「+ 새 배너」로 추가하거나 「기존 기록 가져오기」를 눌러 주세요.</p>`);
}

// ---------- 7계정 입력표 ----------
function slotHtml(slot) {
    if (!slot) return `<span class="slot-empty">·</span>`;
    const chips = (slot.d || []).map((d) => `<span class="drop ${DROP[d.t]?.cls || ""}${d.x ? " dust" : ""}">${esc(d.n || DROP[d.t]?.label || d.t)}</span>`).join("");
    const blank = slot.b ? `<span class="drop blank">${BLANK[slot.b]}</span>` : "";
    const memo = slot.m ? `<div class="slot-memo">${esc(slot.m)}</div>` : "";
    return chips + blank + memo || `<span class="slot-empty">·</span>`;
}

function maxSlot(b) {
    return Math.max(0, ...ACCOUNTS.flatMap((a) => Object.keys(b.results?.[a] || {}).map(Number)));
}

function renderBanner() {
    const b = g.open;
    const n = nikkeOf(b);
    const roster = JSON.parse(localStorage.getItem("hub_roster") || "{}");
    // 매일 무료 1뽑은 날짜 줄(최근 날짜가 위), 나머지는 10연차 줄
    const dates = b.daily ? dailyDates(b, gameDate()) : [];
    const rows = b.daily ? [...new Set([...dates, ...ACCOUNTS.flatMap((a) => Object.keys(b.results?.[a] || {}))])].sort().reverse() : [];
    if (!b.daily) for (let k = 10; k <= g.rows; k += 10) rows.push(String(k));
    const keyLabel = (k) => (b.daily ? `${md(k)}<div>${dates.indexOf(k) + 1 || ""}일째</div>` : k);
    const sums = Object.fromEntries(ACCOUNTS.map((a) => [a, accountSummary(b.results?.[a], b.daily)]));
    // 다시 그려도 보던 위치 유지 (칸 저장 후 맨 위로 튀지 않게)
    const oldWrap = $("#banner-body .pulls-wrap");
    const scroll = oldWrap ? [oldWrap.scrollTop, oldWrap.scrollLeft] : null;
    const unit = b.daily ? "회" : "연";

    $("#banner-body").innerHTML = `
        <div class="dhead">
            ${n ? `<img src="${portraitUrl(n.resource)}" alt="">` : ""}
            <div class="grow">
                <h2>${elementIcon(elementOf(b))} ${esc(b.name)}</h2>
                <div class="muted">${esc(b.type || "출시 타입 없음")} · ${b.start || "날짜 없음"}${b.daily ? ` ~ ${b.end || "끝나는 날 없음"}` : ""}${b.period ? ` · ${esc(b.period)}` : ""}</div>
                ${n ? "" : `<div class="muted">블라블라 니케 목록에 아직 없는 니케입니다. 업데이트 후 사진과 정보가 자동으로 붙습니다.</div>`}
                ${n ? `<div class="tags"><b class="${rareClass(n.rare)}">${n.rare}</b>${nikkeIcons(n)}<span id="banner-extra"></span></div>` : ""}
                ${n ? `<div class="owned">${ACCOUNTS.map((a) => {
                    const r = roster[a]?.nikkes?.find((x) => x.c === n.code);
                    const lb = !r ? "미보유" : r.k >= 7 ? "MAX" : r.k > 0 ? `+${r.k}` : `${r.g}★`;
                    return `<span class="${r ? "" : "dim"}">${esc(a)} ${lb}</span>`;
                }).join("")}<small class="muted">도감 기준</small></div>` : ""}
            </div>
            <div class="row"><button class="btn" id="banner-edit">정보 수정</button></div>
        </div>
        <div class="table-wrap pulls-wrap"><table class="pulls">
            <thead><tr><th class="sticky">${b.daily ? "날짜" : "연차"}</th>${ACCOUNTS.map((a) => `<th>${esc(a)}</th>`).join("")}</tr></thead>
            <tbody>${rows.map((k) => `<tr><td class="sticky key">${keyLabel(k)}</td>${ACCOUNTS.map((a) => {
                const slot = b.results?.[a]?.[k];
                return `<td class="slot ${slot?.b ? "is-blank" : ""}" data-acc="${esc(a)}" data-key="${k}">${slotHtml(slot)}</td>`;
            }).join("")}</tr>`).join("")}</tbody>
            <tfoot><tr><td class="sticky">합계</td>${ACCOUNTS.map((a) => {
                const s = sums[a];
                return `<td>${s.pulls ? `<b>${s.pulls}${unit}</b><div>픽업 ${s.pickup}${s.spook ? ` · 픽뚫 ${s.spook}` : ""}${s.pilgrim ? ` · 필그림 ${s.pilgrim}` : ""}${s.gold ? ` · 골티 ${s.gold}` : ""}</div>${s.firstPickup ? `<div class="muted">첫 픽업 ${s.firstPickup}${unit}</div>` : ""}` : "-"}</td>`;
            }).join("")}</tr></tfoot>
        </table></div>
        ${b.daily ? (rows.length ? "" : `<p class="muted center">시작일이 되면 날짜 줄이 생깁니다. 「정보 수정」에서 시작일을 확인해 주세요.</p>`) : `<div class="row center"><button class="btn" id="more-rows">+ 50연차 더 보기</button></div>`}`;
    if (scroll) { const w = $("#banner-body .pulls-wrap"); w.scrollTop = scroll[0]; w.scrollLeft = scroll[1]; }
    if (n) fillBannerExtra(n);
}

function openBanner(id) {
    g.open = g.banners.find((b) => b.id === id);
    g.rows = g.open.daily ? 0 : Math.max(50, Math.ceil((maxSlot(g.open) + 20) / 10) * 10);
    $("#banner-body").innerHTML = ""; // 다른 배너의 스크롤 위치를 이어받지 않게
    renderBanner();
    $("#banner-dialog").showModal();
}

// ---------- 칸 편집 ----------
function renderSlotEditor() {
    const { banner, account, key, data } = g.slot;
    $("#slot-title").textContent = banner.daily ? `${account} · ${md(key)} 무료 1뽑` : `${account} · ${key}연차 (${Number(key) - 9}~${key})`;
    // 단차에는 골티·올블루·올퍼플이 없음
    for (const el of document.querySelectorAll('#slot-add [data-add="gold"], #slot-blank input[value="blue"], #slot-blank input[value="purple"]')) (el.closest("label") || el).hidden = !!banner.daily;
    $("#slot-drops").innerHTML = data.d.map((d, i) => `<div class="drop-edit">
        <span class="drop ${DROP[d.t].cls}">${DROP[d.t].label}</span>
        <input data-i="${i}" data-f="n" value="${esc(d.n)}" placeholder="${d.t === "gold" ? "몇 장?" : "누구?"}" ${d.t === "gold" ? "" : 'list="gacha-nikke-names"'}>
        ${d.t === "gold" ? "" : `<label><input type="checkbox" data-i="${i}" data-f="x" ${d.x ? "checked" : ""}>중복</label>`}
        <button class="btn small" data-del="${i}" aria-label="삭제">✕</button>
    </div>`).join("") || `<p class="muted">아래 버튼으로 뽑은 SSR을 추가하세요.</p>`;
    document.querySelectorAll("#slot-blank input").forEach((r) => (r.checked = r.value === data.b));
    $("#slot-memo").value = data.m;
}

function openSlot(banner, account, key) {
    const cur = banner.results?.[account]?.[key];
    g.slot = { banner, account, key, data: { d: (cur?.d || []).map((d) => ({ ...d })), b: cur?.b || "", m: cur?.m || "" } };
    renderSlotEditor();
    $("#slot-dialog").showModal();
}

async function storeSlot(banner, account, key, data) {
    await saveSlot(banner.id, account, key, data);
    banner.results ||= {};
    banner.results[account] ||= {};
    if (!data.d.length && !data.b && !data.m.trim()) delete banner.results[account][key];
    else banner.results[account][key] = data;
    if ($("#banner-dialog").open && g.open === banner) renderBanner();
    if (g.view === "list") renderList();
}

async function saveSlotEdit() {
    const { banner, account, key, data } = g.slot;
    const btn = $("#slot-save");
    btn.disabled = true;
    try {
        // 단차에서 아무것도 안 고르고 저장하면 꽝
        await storeSlot(banner, account, key, banner.daily && !data.d.length && !data.b ? { ...BLANK_SLOT(), m: data.m } : data);
        $("#slot-dialog").close();
    } catch (e) { alert(`저장하지 못했습니다: ${e.message}`); }
    btn.disabled = false;
}

// 오늘 무료 1뽑 표의 「꽝」은 바로 저장, 「SSR」은 칸 편집 창을 픽업 한 줄이 들어간 채로 열기
async function quickDaily(btn) {
    const banner = g.banners.find((b) => b.id === btn.dataset.bid);
    const account = btn.dataset.acc, today = gameDate();
    if (btn.dataset.quick === "blank") {
        btn.disabled = true;
        try { await storeSlot(banner, account, today, BLANK_SLOT()); } catch (e) { alert(`저장하지 못했습니다: ${e.message}`); btn.disabled = false; }
        return;
    }
    openSlot(banner, account, today);
    g.slot.data.d.push({ t: "pickup", n: banner.name, x: false });
    renderSlotEditor();
}

// ---------- 배너 정보 ----------
function openInfo(banner) {
    const f = $("#info-form");
    f.dataset.id = banner?.id || "";
    f.name.value = banner?.name || "";
    f.type.value = banner?.type || "";
    f.start.value = banner?.start || "";
    f.period.value = banner?.period || "";
    f.daily.checked = !!banner?.daily;
    f.end.value = banner?.end || "";
    f.end.closest("label").hidden = !f.daily.checked;
    $("#info-delete").hidden = !banner;
    $("#info-title").textContent = banner ? "배너 정보 수정" : "새 배너";
    $("#info-dialog").showModal();
}

async function saveInfo(e) {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    if (!name) { f.name.focus(); return; }
    const n = g.metaByName.get(squash(name));
    const daily = f.daily.checked;
    const info = { name, type: f.type.value.trim() || (daily ? "매일 무료 1뽑" : ""), start: f.start.value || parseStart(f.period.value), period: f.period.value.trim(), element: n?.element || "",
        daily, end: daily ? f.end.value || parseEnd(f.period.value) : "" };
    const id = f.dataset.id || newBannerId();
    const existing = g.banners.find((b) => b.id === id);
    if (existing && !n) info.element = existing.element; // 이름을 못 찾으면 원래 속성 유지
    try {
        await saveBannerInfo(id, existing ? info : { ...info, results: {} });
        if (existing) Object.assign(existing, info);
        else g.banners.push({ id, ...info, results: {} });
        sortBanners();
        $("#info-dialog").close();
        renderList();
        if (g.open?.id === id) renderBanner();
        else if (!existing) openBanner(id);
    } catch (err) { alert(`저장하지 못했습니다: ${err.message}`); }
}

async function removeBanner() {
    const id = $("#info-form").dataset.id;
    const b = g.banners.find((x) => x.id === id);
    if (!b || !confirm(`「${b.name}」 배너와 7계정 기록을 모두 지울까요? 되돌릴 수 없습니다.`)) return;
    await deleteBanner(id);
    g.banners = g.banners.filter((x) => x.id !== id);
    $("#info-dialog").close();
    $("#banner-dialog").close();
    renderList();
}

// ---------- 통계 ----------
function statRow(label, banners, accounts) {
    const t = { banners: 0, pulls: 0, pickup: 0, spook: 0, pilgrim: 0, gold: 0 };
    for (const b of banners) for (const a of accounts) {
        const slots = b.results?.[a];
        if (!slots || !Object.keys(slots).length) continue;
        const s = accountSummary(slots, b.daily);
        t.banners++; t.pulls += s.pulls; t.pickup += s.pickup; t.spook += s.spook; t.pilgrim += s.pilgrim; t.gold += s.gold;
    }
    const ssr = t.pickup + t.spook + t.pilgrim;
    const pct = (v) => (t.pulls ? `${((v / t.pulls) * 100).toFixed(2)}%` : "-");
    return `<tr><td class="sticky"><b>${esc(label)}</b></td><td>${t.banners}</td><td>${t.pulls.toLocaleString()}</td><td>${t.pickup}</td><td>${t.spook}</td><td>${t.pilgrim}</td><td>${t.gold}</td>
        <td>${pct(ssr)}</td><td>${pct(t.pickup)}</td><td><b>${t.pickup ? Math.round(t.pulls / t.pickup) : "-"}</b></td></tr>`;
}

function renderStats() {
    const list = filtered();
    const head = `<thead><tr><th class="sticky"></th><th>배너</th><th>총 연차</th><th>픽업</th><th>픽뚫</th><th>필그림</th><th>골티</th><th>SSR 확률</th><th>픽업 확률</th><th>픽업 1장당</th></tr></thead>`;
    const cats = [...new Set(list.map((b) => typeCategory(b.type)))];
    $("#gacha-count").textContent = `${list.length}개 배너 기준`;
    $("#gacha-view").innerHTML = `
        <h3 class="sec">계정별</h3>
        <div class="table-wrap"><table class="stats">${head}<tbody>
            ${ACCOUNTS.map((a) => statRow(a, list, [a])).join("")}
            ${statRow("전체", list, ACCOUNTS)}
        </tbody></table></div>
        <h3 class="sec">출시 타입별 (7계정 합산)</h3>
        <div class="table-wrap"><table class="stats">${head}<tbody>
            ${cats.map((c) => statRow(c, list.filter((b) => typeCategory(b.type) === c), ACCOUNTS)).join("")}
        </tbody></table></div>
        <p class="muted">SSR 확률 = (픽업+픽뚫+필그림) ÷ 총 연차. 총 연차는 계정마다 기록된 가장 큰 연차 번호 기준입니다.</p>`;
}

function render() {
    document.querySelectorAll("#gacha-subtabs button").forEach((b) => b.classList.toggle("on", b.dataset.gview === g.view));
    g.view === "list" ? renderList() : renderStats();
}

// ---------- 기존 기록 가져오기 ----------
async function runImport() {
    const btn = $("#gacha-import");
    btn.disabled = true;
    btn.textContent = "기존 기록 읽는 중…";
    try {
        const { banners, skipped } = await buildLegacyBanners(await loadReleaseDates());
        for (const b of banners) b.element ||= nikkeOf(b)?.element || "";
        const edited = g.banners.filter((b) => b.edited && b.legacy).length;
        const ok = confirm(`기존 가챠 트래커에서 배너 ${banners.length}개를 찾았습니다.${skipped ? ` (계정 이름을 알 수 없는 기록 ${skipped}건 제외)` : ""}\n\n허브로 가져올까요?\n· 기존 트래커 데이터는 그대로 남습니다.${edited ? `\n· 허브에서 이미 고친 배너 ${edited}개는 덮어쓰지 않습니다.` : ""}`);
        if (ok) {
            btn.textContent = "저장 중…";
            const r = await importLegacy(banners, g.banners);
            g.banners = await loadBanners();
            sortBanners();
            render();
            alert(`가져오기 완료: ${r.written}개 저장${r.keptEdited ? `, 허브에서 고친 ${r.keptEdited}개는 유지` : ""}`);
        }
    } catch (e) { alert(`가져오지 못했습니다: ${e.message}`); }
    btn.disabled = false;
    btn.textContent = "기존 기록 가져오기";
}

// ---------- 시작 ----------
let started = false;
export async function initGacha() {
    if (started) return;
    started = true;
    $("#gacha-view").innerHTML = `<p class="empty">가챠 기록을 불러오는 중…</p>`;
    const [meta, banners] = await Promise.all([loadNikkeList(), loadBanners()]);
    g.meta = meta;
    for (const n of meta.values()) g.metaByName.set(squash(n.name), n);
    g.banners = banners;
    sortBanners();

    $("#gacha-nikke-names").innerHTML = [...meta.values()].filter((n) => n.rare === "SSR").map((n) => `<option value="${esc(n.name)}">`).join("");
    $("#gacha-types").innerHTML = [...new Set([...BANNER_TYPES, ...banners.map((b) => b.type).filter(Boolean)])].map((t) => `<option value="${esc(t)}">`).join("");
    const years = [...new Set(banners.map((b) => (b.start || "").slice(0, 4)).filter(Boolean))].sort().reverse();
    $("#g-year").innerHTML = `<option value="">전체 기간</option>` + years.map((y) => `<option value="${y}">${y}년</option>`).join("");

    document.querySelectorAll("#gacha-subtabs button").forEach((b) => b.addEventListener("click", () => { g.view = b.dataset.gview; render(); }));
    $("#g-q").addEventListener("input", (e) => { g.q = e.target.value; render(); });
    $("#g-cat").addEventListener("change", (e) => { g.cat = e.target.value; render(); });
    $("#g-year").addEventListener("change", (e) => { g.year = e.target.value; render(); });
    $("#gacha-new").addEventListener("click", () => openInfo(null));
    $("#gacha-import").addEventListener("click", runImport);
    $("#gacha-view").addEventListener("click", (e) => {
        const quick = e.target.closest("[data-quick]");
        if (quick) return quickDaily(quick);
        const cell = e.target.closest("td.slot[data-bid]");
        if (cell) return openSlot(g.banners.find((b) => b.id === cell.dataset.bid), cell.dataset.acc, cell.dataset.key);
        const id = e.target.closest("[data-open]")?.dataset.open || e.target.closest(".banner-row")?.dataset.id;
        if (id) openBanner(id);
    });

    $("#banner-body").addEventListener("click", (e) => {
        const cell = e.target.closest("td.slot");
        if (cell) return openSlot(g.open, cell.dataset.acc, cell.dataset.key);
        if (e.target.id === "more-rows") { g.rows += 50; renderBanner(); }
        if (e.target.id === "banner-edit") openInfo(g.open);
    });

    $("#slot-add").addEventListener("click", (e) => {
        const t = e.target.dataset.add;
        if (!t) return;
        g.slot.data.d.push({ t, n: "", x: false });
        if (g.slot.data.b) g.slot.data.b = "";
        renderSlotEditor();
        $(`#slot-drops input[data-i="${g.slot.data.d.length - 1}"]`)?.focus();
    });
    $("#slot-drops").addEventListener("input", (e) => {
        const i = e.target.dataset.i;
        if (i === undefined) return;
        g.slot.data.d[i][e.target.dataset.f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    });
    $("#slot-drops").addEventListener("click", (e) => {
        const i = e.target.dataset.del;
        if (i !== undefined) { g.slot.data.d.splice(i, 1); renderSlotEditor(); }
    });
    $("#slot-blank").addEventListener("change", (e) => { g.slot.data.b = e.target.value; });
    $("#slot-memo").addEventListener("input", (e) => { g.slot.data.m = e.target.value; });
    $("#slot-save").addEventListener("click", saveSlotEdit);
    $("#slot-clear").addEventListener("click", () => { g.slot.data = { d: [], b: "", m: "" }; renderSlotEditor(); });

    $("#info-form").addEventListener("submit", saveInfo);
    $("#info-form").daily.addEventListener("change", (e) => {
        const f = e.target.form;
        f.end.closest("label").hidden = !e.target.checked;
        if (e.target.checked) { f.type.value ||= "매일 무료 1뽑"; f.end.value ||= parseEnd(f.period.value); }
    });
    $("#info-form").period.addEventListener("change", (e) => { const f = e.target.form; if (f.daily.checked && !f.end.value) f.end.value = parseEnd(f.period.value); });
    $("#info-delete").addEventListener("click", removeBanner);

    render();
}
