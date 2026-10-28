import { ACCOUNTS } from "./config.js";
import { loadNikkeList, portraitUrl } from "./meta.js";
import { loadDays, gameDate, runCountFor, expectedOf, actualOf, excludedFromDist } from "./intercept-data.js";
import { loadRaids, best, fmtScore } from "./raid-data.js";
import { loadBanners, accountSummary } from "./gacha-data.js";
import { openTodayEntry } from "./intercept.js";

// 홈: 각 탭의 데이터를 읽기만 해서 오늘 할 일과 최근 결과를 요약
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pctBadge = (p) => (p == null ? "" : `<span class="pct ${p <= 1 ? "top1" : p <= 3 ? "top3" : p <= 5 ? "top5" : "rest"}">${p}%</span>`);
const card = (title, body, action = "") => `<section class="dash-card"><div class="dash-head"><h3>${title}</h3>${action}</div>${body}</section>`;

function interceptCard(days, rosters) {
    const today = gameDate();
    const day = days.find((d) => d.date === today);
    const done = ACCOUNTS.filter((a) => day?.results?.[a]).length;
    const rows = ACCOUNTS.map((a) => {
        const x = day?.results?.[a];
        const count = runCountFor(rosters[a]?.synchro, today);
        const status = !x ? `<span class="muted">미입력</span>` : x.skip ? `<span class="muted">미참여</span>`
            : `<b>${x.runs.map((r) => r.mod).join("·")}</b>${x.fb ? ` <span class="fmods">+${x.runs.map((r) => r.fmod).join("·")}</span>` : ""}`;
        return `<tr class="${x ? "" : "todo"}"><td>${esc(a)}</td><td>${count}회</td><td>${status}</td></tr>`;
    }).join("");
    return card(`오늘 특특요 <small class="muted">${today.slice(5).replace("-", "/")} · 05시 기준 · ${done}/${ACCOUNTS.length}</small>`,
        `<table class="dash-table"><tbody>${rows}</tbody></table>`,
        `<button class="btn primary small" id="dash-ic-entry">입력하기</button>`);
}

function interceptMonthCard(days) {
    const month = gameDate().slice(0, 7);
    const list = days.filter((d) => d.date.startsWith(month));
    const rows = ACCOUNTS.map((a) => {
        let exp = 0, act = 0;
        for (const d of list) { const x = d.results?.[a]; if (x && !excludedFromDist(x)) { exp += expectedOf(x, d.date); act += actualOf(x); } }
        const luck = exp ? (act / exp) * 100 : null;
        return `<tr><td>${esc(a)}</td><td>${act}개</td><td>${luck == null ? "-" : `<b class="${luck >= 100 ? "good" : "bad"}">${luck.toFixed(1)}%</b>`}</td>
            <td class="barcell"><div class="bar ${luck >= 100 ? "good" : "bad"}" style="width:${Math.min(luck || 0, 150) / 1.5}%"></div></td></tr>`;
    }).join("");
    return card(`이번 달 특특요 운빨 <small class="muted">${month.replace("-", "년 ")}월 · ${list.length}일</small>`, `<table class="dash-table"><tbody>${rows}</tbody></table>`);
}

function raidCard(raids, kind, title) {
    const latest = raids.filter((r) => r.kind === kind)
        .sort((a, b) => kind === "solo" ? (b.season ?? 0) - (a.season ?? 0) : (b.start || "").localeCompare(a.start || ""))[0];
    if (!latest) return card(title, `<p class="muted">기록이 없습니다.</p>`);
    const name = `${kind === "solo" && latest.season != null ? `S${latest.season} ` : ""}${latest.boss}`;
    const rows = ACCOUNTS.map((a) => {
        const b = best(latest.results?.[a]);
        return `<tr><td>${esc(a)}</td><td>${b ? `<b>${fmtScore(b.score)}</b>` : `<span class="muted">-</span>`}</td><td>${b ? pctBadge(b.pct) : ""}</td></tr>`;
    }).join("");
    return card(`${title} <small class="muted">${esc(name)}</small>`, `<table class="dash-table"><tbody>${rows}</tbody></table>`);
}

function gachaCard(banners, meta) {
    const byName = new Map([...meta.values()].map((n) => [n.name.replace(/\s/g, ""), n]));
    const latest = banners.filter((b) => b.start).sort((a, b) => b.start.localeCompare(a.start)).slice(0, 3);
    const body = latest.map((b) => {
        const n = byName.get(b.name.replace(/\s/g, ""));
        return `<div class="dash-banner">${n ? `<img src="${portraitUrl(n.resource)}" alt="">` : `<div class="noimg"></div>`}
            <div class="grow"><b>${esc(b.name)}</b><div class="muted">${esc(b.type || "")} · ${b.start}</div>
            <div class="bacc">${ACCOUNTS.map((a) => {
                const slots = b.results?.[a];
                if (!slots || !Object.keys(slots).length) return `<span class="bchip none">${esc(a)} -</span>`;
                const s = accountSummary(slots);
                return `<span class="bchip ${s.pickup ? "hit" : "miss"}">${esc(a)} <b>${s.pulls}</b>${s.pickup ? `<i>★${s.pickup}</i>` : ""}</span>`;
            }).join("")}</div></div></div>`;
    }).join("") || `<p class="muted">배너가 없습니다.</p>`;
    return card("최근 가챠", body);
}

function accountCard(rosters, meta) {
    const ssr = new Set([...meta.values()].filter((m) => m.rare === "SSR").map((m) => m.code));
    const times = Object.values(rosters).map((r) => r.fetched_at).sort();
    const rows = ACCOUNTS.map((a) => {
        const r = rosters[a];
        if (!r) return `<tr><td>${esc(a)}</td><td colspan="3" class="muted">도감 데이터 없음</td></tr>`;
        const owned = r.nikkes.filter((n) => ssr.has(n.c));
        const maxed = owned.filter((n) => n.k >= 7).length;
        return `<tr><td>${esc(a)}</td><td>싱크로 <b>${r.synchro ?? "-"}</b></td><td>SSR <b>${owned.length}</b></td><td>MAX <b>${maxed}</b></td></tr>`;
    }).join("");
    return card(`계정 현황 <small class="muted">${times.length ? `도감 ${new Date(times[times.length - 1]).toLocaleDateString("ko-KR")} 갱신` : ""}</small>`,
        `<table class="dash-table"><tbody>${rows}</tbody></table>`);
}

export async function renderDashboard() {
    const view = $("#dash-view");
    view.innerHTML = `<p class="empty">불러오는 중…</p>`;
    const rosters = JSON.parse(localStorage.getItem("hub_roster") || "{}");
    const [days, raids, banners, meta] = await Promise.all([loadDays(), loadRaids(), loadBanners(), loadNikkeList()]);
    view.innerHTML = `<div class="dash-links"><a class="btn" href="https://game.naver.com/lounge/nikke/board/48" target="_blank" rel="noopener">공식 공지·점검 일정 (네이버 라운지)</a></div>
    <div class="dash-grid">
        ${interceptCard(days, rosters)}
        ${interceptMonthCard(days)}
        ${raidCard(raids, "solo", "최근 솔로 레이드")}
        ${raidCard(raids, "coop", "최근 협동 작전")}
        ${gachaCard(banners, meta)}
        ${accountCard(rosters, meta)}
    </div>`;
    $("#dash-ic-entry")?.addEventListener("click", () => {
        document.querySelector('.hub-tab[data-tab="interception"]').click();
        openTodayEntry();
    });
}
