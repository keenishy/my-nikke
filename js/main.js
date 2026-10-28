import { EXTERNAL_TABS } from "./config.js";
import { initCollection } from "./collection.js";
import { initGacha } from "./gacha.js";
import { initRaid } from "./raid.js";
import { initUnion } from "./union.js";
import { initIntercept } from "./intercept.js";
import { renderDashboard } from "./dashboard.js";

// 탭을 처음 열 때 한 번만 준비하는 기능들
const NATIVE_TABS = {
    gacha: () => initGacha().catch((e) => {
        console.error(e);
        document.getElementById("gacha-view").innerHTML = `<p class="empty">가챠 기록을 불러오지 못했습니다: ${e.message}</p>`;
    }),
    ranking: () => initRaid().catch((e) => {
        console.error(e);
        document.getElementById("raid-view").innerHTML = `<p class="empty">레이드 기록을 불러오지 못했습니다: ${e.message}</p>`;
    }),
    union: () => initUnion().catch((e) => {
        console.error(e);
        document.getElementById("union-view").innerHTML = `<p class="empty">유니온 정보를 불러오지 못했습니다: ${e.message}</p>`;
    }),
    // 홈은 열 때마다 최신 상태로 다시 그림
    dashboard: () => renderDashboard().catch((e) => {
        console.error(e);
        document.getElementById("dash-view").innerHTML = `<p class="empty">홈을 불러오지 못했습니다: ${e.message}</p>`;
    }),
    interception: () => initIntercept().catch((e) => {
        console.error(e);
        document.getElementById("ic-view").innerHTML = `<p class="empty">특특요 기록을 불러오지 못했습니다: ${e.message}</p>`;
    }),
};

// 기존 사이트 탭은 처음 열 때 iframe을 만들어서 불필요한 로딩을 피함
function showTab(name) {
    document.querySelectorAll(".hub-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
    const panel = document.getElementById(`tab-${name}`);
    if (panel.dataset.src && !panel.firstElementChild) {
        const f = document.createElement("iframe");
        f.src = EXTERNAL_TABS[panel.dataset.src];
        f.title = name;
        panel.appendChild(f);
    }
    NATIVE_TABS[name]?.();
    localStorage.setItem("hub_tab", name);
}

document.querySelectorAll(".hub-tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
showTab(localStorage.getItem("hub_tab") || "dashboard");

initCollection().catch((e) => {
    console.error(e);
    document.getElementById("view").innerHTML = `<p class="empty">도감을 불러오지 못했습니다: ${e.message}</p>`;
});
