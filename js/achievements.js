import { collection, getDocs, doc, setDoc, updateDoc, deleteDoc, FieldPath } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./store.js";
import { ACCOUNTS } from "./config.js";

// 업적 문서 (achievements/{id}): { name, target: 목표 횟수, note, order, done: { 계정: 달성 횟수 } }
const COL = "achievements";
const META_ID = "_meta"; // { seeded: true } 기본 업적을 넣었는지 (지운 뒤 다른 기기에서 다시 생기지 않게)
const DEFAULTS = ["챔피언 아레나 한 시즌에 응원 모두 성공", "챔피언 아레나 한 시즌에 응원 모두 실패"];

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let list = null;
async function load() {
    if (list) return list;
    const snap = await getDocs(collection(db, COL));
    const seeded = snap.docs.some((d) => d.id === META_ID);
    list = snap.docs.filter((d) => d.id !== META_ID).map((d) => ({ id: d.id, ...d.data() }));
    // 처음 한 번만 기본 업적 2개를 넣어 둠
    if (!seeded) {
        for (const [i, name] of DEFAULTS.entries()) {
            const a = { id: newId() + i, name, target: 1, note: "", order: Date.now() + i, done: {} };
            await setDoc(doc(db, COL, a.id), { name: a.name, target: a.target, note: a.note, order: a.order, done: a.done });
            list.push(a);
        }
        await setDoc(doc(db, COL, META_ID), { seeded: true });
    }
    return list;
}

const target = (a) => Math.max(1, Number(a.target) || 1);
const count = (a, acc) => Number(a.done?.[acc]) || 0;
const doneBy = (a) => ACCOUNTS.filter((acc) => count(a, acc) >= target(a)).length;

function rowHtml(a) {
    const t = target(a), all = doneBy(a) === ACCOUNTS.length;
    return `<div class="ach ${all ? "all" : ""}" data-id="${esc(a.id)}">
        <div class="ach-head"><b>${esc(a.name)}</b><span class="muted">${doneBy(a)}/${ACCOUNTS.length}</span>
            <button class="ach-edit" data-edit title="수정">✎</button></div>
        ${a.note ? `<div class="muted ach-note">${esc(a.note)}</div>` : ""}
        <div class="ach-accs">${ACCOUNTS.map((acc) => {
            const n = count(a, acc), ok = n >= t;
            return `<button class="ach-acc ${ok ? "ok" : n ? "part" : ""}" data-acc="${esc(acc)}" title="${t > 1 ? "누를 때마다 +1, 다 채운 뒤 누르면 0으로" : "누르면 달성/미달성"}">${ok ? "✓ " : ""}${esc(acc)}${t > 1 ? ` <small>${Math.min(n, t)}/${t}</small>` : ""}</button>`;
        }).join("")}</div>
    </div>`;
}

export async function achievementsCardHtml() {
    let body;
    try {
        const items = (await load()).slice().sort((a, b) => (doneBy(a) === ACCOUNTS.length) - (doneBy(b) === ACCOUNTS.length) || (a.order || 0) - (b.order || 0));
        body = items.map(rowHtml).join("") || `<p class="muted">업적이 없습니다. 「+ 업적」으로 추가해 주세요.</p>`;
    } catch (e) { body = `<p class="muted">업적을 불러오지 못했습니다: ${esc(e.message)}</p>`; }
    return `<section class="dash-card ach-card" id="ach-card"><div class="dash-head"><h3>업적 <small class="muted">계정 이름을 눌러 달성 표시</small></h3>
        <button class="btn small" id="ach-add">+ 업적</button></div><div id="ach-list">${body}</div></section>`;
}

async function rerender() {
    const card = $("#ach-card");
    if (card) card.outerHTML = await achievementsCardHtml();
}

// ---------- 추가·수정 창 ----------
function openForm(a) {
    const f = $("#ach-form");
    f.dataset.id = a?.id || "";
    f.name.value = a?.name || "";
    f.target.value = a ? target(a) : 1;
    f.note.value = a?.note || "";
    $("#ach-title").textContent = a ? "업적 수정" : "새 업적";
    $("#ach-delete").hidden = !a;
    $("#ach-dialog").showModal();
    f.name.focus();
}

async function saveForm(e) {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    if (!name) return;
    const data = { name, target: Math.max(1, Number(f.target.value) || 1), note: f.note.value.trim() };
    const cur = list.find((x) => x.id === f.dataset.id);
    try {
        if (cur) { await updateDoc(doc(db, COL, cur.id), data); Object.assign(cur, data); }
        else {
            const a = { id: newId(), ...data, order: Date.now(), done: {} };
            await setDoc(doc(db, COL, a.id), { name: a.name, target: a.target, note: a.note, order: a.order, done: a.done });
            list.push(a);
        }
        $("#ach-dialog").close();
        rerender();
    } catch (err) { alert(`저장하지 못했습니다: ${err.message}`); }
}

async function removeCurrent() {
    const a = list.find((x) => x.id === $("#ach-form").dataset.id);
    if (!a || !confirm(`「${a.name}」 업적을 지울까요? 계정별 달성 기록도 함께 지워집니다.`)) return;
    try {
        await deleteDoc(doc(db, COL, a.id));
        list = list.filter((x) => x !== a);
        $("#ach-dialog").close();
        rerender();
    } catch (err) { alert(`지우지 못했습니다: ${err.message}`); }
}

// 계정 버튼: 목표 1이면 달성↔미달성, 목표가 크면 +1씩, 다 채운 뒤 누르면 0
async function bump(a, acc) {
    const t = target(a), n = count(a, acc);
    const next = t === 1 ? (n >= 1 ? 0 : 1) : n >= t ? 0 : n + 1;
    const prev = n;
    a.done = { ...(a.done || {}), [acc]: next };
    rerender();
    try { await updateDoc(doc(db, COL, a.id), new FieldPath("done", acc), next); }
    catch (err) { a.done[acc] = prev; rerender(); alert(`저장하지 못했습니다: ${err.message}`); }
}

let wired = false;
export function wireAchievements() {
    if (wired) return;
    wired = true;
    // 홈은 다시 그려지므로 클릭은 문서에서 한 번만 받음
    document.addEventListener("click", (e) => {
        if (e.target.closest("#ach-add")) return openForm(null);
        const row = e.target.closest("#ach-card .ach");
        if (!row) return;
        const a = list?.find((x) => x.id === row.dataset.id);
        if (!a) return;
        if (e.target.closest("[data-edit]")) return openForm(a);
        const acc = e.target.closest(".ach-acc")?.dataset.acc;
        if (acc) bump(a, acc);
    });
    $("#ach-form").addEventListener("submit", saveForm);
    $("#ach-delete").addEventListener("click", removeCurrent);
}
