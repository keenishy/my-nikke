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

// 글자 칸 밖에서 백스페이스를 누르면 일부 브라우저(웨일 등)는 이전 페이지로 가 버리므로 막음
const TEXT_INPUT = /^(text|search|number|email|url|tel|password|date|time|datetime-local|month|week)$/;
document.addEventListener("keydown", (e) => {
    if (e.key !== "Backspace" || e.defaultPrevented) return;
    const el = e.target;
    const editable = el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && TEXT_INPUT.test(el.type) && !el.readOnly);
    if (!editable) e.preventDefault();
});

// 메모 칸에 ✕ 버튼: 글자가 있을 때만 보이고, 누르면 비운 뒤 그 칸에 다시 초점
// (탭마다 따로 만들지 않고 메모 칸이 화면에 생기면 자동으로 붙임)
const CLEARABLE = 'input.memo, input[name="note"], input[data-note="memo"], textarea.union-memo';
function addClear(el) {
    if (el.dataset.clearable) return;
    el.dataset.clearable = "1";
    const wrap = document.createElement("span");
    wrap.className = `clear-wrap${el.tagName === "TEXTAREA" ? " ta" : ""}`;
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "memo-clear";
    btn.textContent = "✕";
    btn.title = "지우기";
    btn.tabIndex = -1;
    wrap.appendChild(btn);
    const sync = () => { btn.hidden = !el.value; };
    // 코드에서 value를 바꿔도(입력 창을 다시 열 때 등) 버튼 표시가 맞도록
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    Object.defineProperty(el, "value", { configurable: true, get: () => desc.get.call(el), set: (v) => { desc.set.call(el, v); sync(); } });
    el.addEventListener("input", sync);
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.focus();
    });
    sync();
}
const scanClearable = (root) => root.querySelectorAll?.(CLEARABLE).forEach(addClear);
scanClearable(document);
new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches(CLEARABLE)) addClear(n); scanClearable(n); }
}).observe(document.body, { childList: true, subtree: true });
