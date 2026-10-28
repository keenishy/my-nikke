import { EXTERNAL_TABS } from "./config.js";
import { currentUser, signIn, logOut } from "./store.js";
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

// ---------- 로그인 ----------
// Firebase에서 Google 로그인을 아직 안 켰으면 "로그인 없이 계속"으로 넘어갈 수 있게 둠 (보안 규칙을 잠그기 전까지만 동작)
const SETUP_ERRORS = {
    "auth/operation-not-allowed": "Firebase에서 Google 로그인이 아직 꺼져 있습니다.",
    "auth/configuration-not-found": "Firebase에서 Google 로그인이 아직 꺼져 있습니다.",
    "auth/unauthorized-domain": `Firebase 승인된 도메인에 ${location.hostname}이 없습니다.`,
};

function loginGate() {
    const gate = document.createElement("div");
    gate.className = "login-gate";
    gate.innerHTML = `<div class="login-card"><div class="brand">NIKKE HUB</div>
        <p>기록을 보려면 Google 계정으로 로그인해 주세요.</p>
        <button class="btn primary" id="login-btn">Google로 로그인</button>
        <p class="muted" id="login-msg"></p>
        <button class="btn small" id="login-skip" hidden>로그인 없이 계속</button></div>`;
    document.body.appendChild(gate);
    return new Promise((ok) => {
        gate.querySelector("#login-btn").addEventListener("click", async () => {
            const msg = gate.querySelector("#login-msg");
            msg.textContent = "로그인 창을 확인해 주세요…";
            try {
                const { user } = await signIn();
                gate.remove();
                ok(user);
            } catch (e) {
                console.error(e);
                msg.textContent = SETUP_ERRORS[e.code] || (e.code === "auth/popup-closed-by-user" ? "로그인 창이 닫혔습니다." : `로그인하지 못했습니다 (${e.code || e.message})`);
                gate.querySelector("#login-skip").hidden = !SETUP_ERRORS[e.code];
            }
        });
        gate.querySelector("#login-skip").addEventListener("click", () => { gate.remove(); ok(null); });
    });
}

const user = (await currentUser()) || (await loginGate());
if (user) {
    const btn = document.getElementById("user-btn");
    btn.hidden = false;
    btn.title = `${user.email} 로그아웃`;
    btn.addEventListener("click", async () => { if (confirm(`${user.email} 계정에서 로그아웃할까요?`)) { await logOut(); location.reload(); } });
}

document.querySelectorAll(".hub-tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
showTab(localStorage.getItem("hub_tab") || "dashboard");

initCollection().catch((e) => {
    console.error(e);
    document.getElementById("view").innerHTML = `<p class="empty">도감을 불러오지 못했습니다: ${e.message}</p>`;
});
