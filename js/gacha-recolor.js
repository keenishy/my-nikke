import { ACCOUNTS } from "./config.js";
import { parseStart } from "./gacha-data.js";
import { readWorkbook, parseBlocks, sheetAccount } from "./xlsx-colors.js";

// 엑셀 글자 색으로 허브 가챠 칸의 구분(픽업/픽뚫/가루/필그림)만 고침. 니케·칸 추가나 삭제는 하지 않음
const norm = (s) => String(s || "").replace(/[\s:·：()（）]/g, "").toLowerCase();
const sameName = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a)))); };
export const KIND_LABEL = { pickup: "픽업", spook: "픽뚫", dust: "픽뚫(가루)", pilgrim: "필그림" };
export const dropLabel = (d) => (d.t === "spook" && d.x ? "dust" : d.t);

function blockDate(when) {
    const s = parseStart(when);
    if (s) return s;
    const m = String(when).match(/(\d\d)\.(\d\d)\.(\d\d)/);
    return m ? `20${m[1]}-${m[2]}-${m[3]}` : "";
}

const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

function findBanner(block, banners) {
    let c = banners.filter((b) => !b.daily && norm(b.name) === norm(block.name));
    if (c.length <= 1) return c[0] || null;
    const date = blockDate(block.when);
    if (date) {
        const dated = c.filter((b) => b.start).sort((x, y) => days(x.start, date) - days(y.start, date));
        if (dated[0] && days(dated[0].start, date) <= 10) return dated[0];
    }
    const rerun = /복각/.test(block.type);
    c = c.filter((b) => /복각/.test(b.type || "") === rerun);
    return c.length === 1 ? c[0] : null;
}

// 엑셀 조각 색 → 허브 구분. 픽업·필그림의 중복 표시는 허브 값을 유지
function convert(drop, token) {
    if (token.kind === "pickup") return { ...drop, t: "pickup" };
    if (token.kind === "pilgrim") return { ...drop, t: "pilgrim" };
    if (token.kind === "dust") return { ...drop, t: "spook", x: true };
    if (token.kind === "plain") return { ...drop, t: "spook", x: false };
    return null;
}

function planSlot(slot, tokens, srNames) {
    const drops = slot.d.map((d, i) => ({ d, i })).filter((x) => x.d.t !== "gold");
    const used = new Set(), pairs = new Map();
    for (const x of drops) {
        if (!x.d.n) continue;
        const k = tokens.findIndex((t, j) => !used.has(j) && sameName(t.text, x.d.n));
        if (k >= 0) { used.add(k); pairs.set(x.i, tokens[k]); }
    }
    const restDrops = drops.filter((x) => !pairs.has(x.i));
    const rest = tokens.filter((_, j) => !used.has(j));
    const ssrLike = rest.filter((t) => t.kind !== "plain" || !srNames.has(norm(t.text)));
    const colored = rest.filter((t) => t.kind !== "plain");
    let problem = "";
    if (restDrops.length) {
        const pick = ssrLike.length === restDrops.length ? ssrLike : colored.length === restDrops.length ? colored : null;
        if (pick) restDrops.forEach((x, j) => pairs.set(x.i, pick[j]));
        else problem = `허브 ${drops.length}명 / 엑셀 ${tokens.length}개 이름이 맞지 않음`;
    } else if (colored.length) {
        problem = `엑셀에만 있는 색 이름 ${colored.length}개`;
    }
    const after = slot.d.map((d, i) => {
        const t = pairs.get(i);
        const nd = t && convert(d, t);
        return nd ? { ...nd, n: d.n || t.text } : d;
    });
    if (!problem && [...pairs.values()].some((t) => t.kind === "unknown")) problem = "알 수 없는 색";
    const changed = after.some((d, i) => d.t !== slot.d[i].t || !!d.x !== !!slot.d[i].x || d.n !== slot.d[i].n);
    return { after, changed, problem };
}

export async function buildRecolorPlan(file, banners, meta) {
    const srNames = new Set([...meta.values()].filter((n) => n.rare !== "SSR").map((n) => norm(n.name)));
    const sheets = await readWorkbook(file);
    const plan = { changes: [], problems: [], missingBanners: new Map(), missingSlots: [], eras: [], skippedSheets: [] };
    for (const sheet of sheets) {
        const account = sheetAccount(sheet.name);
        if (!/^\d+\s/.test(sheet.name)) continue;
        if (!ACCOUNTS.includes(account)) { plan.skippedSheets.push(sheet.name); continue; }
        const blocks = parseBlocks(sheet);
        // 색으로 구분하기 시작한 뒤의 배너만 (위쪽이 최신). 그 전 배너는 검은 글자가 픽업일 수도 있음
        const lastColored = Math.max(-1, ...blocks.filter((b) => Object.values(b.slots).some((ts) => ts.some((t) => t.kind !== "plain"))).map((b) => b.row));
        const era = blocks.filter((b) => b.row <= lastColored);
        const filled = era.filter((b) => Object.keys(b.slots).length);
        plan.eras.push({ account, oldest: filled[filled.length - 1]?.name || "", count: filled.length });
        for (const block of era) {
            if (!Object.keys(block.slots).length) continue;
            const banner = findBanner(block, banners);
            if (!banner) { plan.missingBanners.set(block.name, [...(plan.missingBanners.get(block.name) || []), account]); continue; }
            for (const [key, tokens] of Object.entries(block.slots)) {
                const slot = banner.results?.[account]?.[key];
                if (!slot?.d?.length) {
                    if (tokens.some((t) => t.kind !== "plain" || !srNames.has(norm(t.text)))) plan.missingSlots.push({ banner, account, key, tokens });
                    continue;
                }
                const r = planSlot(slot, tokens, srNames);
                const row = { banner, account, key, before: slot.d, after: r.after, tokens, slot };
                if (r.changed) plan.changes.push(row);
                if (r.problem) plan.problems.push({ ...row, msg: r.problem });
            }
        }
    }
    return plan;
}
