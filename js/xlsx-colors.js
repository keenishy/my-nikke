// 예전 수기 가챠 엑셀(계정별 시트)을 브라우저에서 읽어 글자 색으로 픽업/픽뚫/가루/필그림을 구분
// xlsx는 zip이므로 브라우저 내장 DecompressionStream으로 풀고, 셀 글자 색은 styles·sharedStrings에서 읽음

// ---------- zip ----------
async function unzip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("xlsx 파일이 아닙니다");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const files = new Map();
    for (let i = 0; i < count; i++) {
        const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
        const local = dv.getUint32(p + 42, true);
        const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
        files.set(name, { method, size, local });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return async (name) => {
        const f = files.get(name);
        if (!f) return null;
        const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
        const data = new Uint8Array(buf, start, f.size);
        if (f.method === 0) return dec.decode(data);
        return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    };
}

const xml = (text) => new DOMParser().parseFromString(text || "<x/>", "application/xml");
const kids = (el, tag) => [...el.children].filter((c) => c.localName === tag);
const kid = (el, tag) => kids(el, tag)[0];
const all = (el, tag) => [...el.getElementsByTagNameNS("*", tag)];

// ---------- 색 ----------
// 테마 색 번호: 0 lt1, 1 dk1, 2 lt2, 3 dk2, 4~9 accent1~6
function themeColors(doc) {
    const scheme = all(doc, "clrScheme")[0];
    if (!scheme) return [];
    const val = (name) => { const e = kid(scheme, name); const c = e && (kid(e, "srgbClr") || kid(e, "sysClr")); return c?.getAttribute("val") === "windowText" ? "000000" : c?.getAttribute("lastClr") || c?.getAttribute("val") || ""; };
    return ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map(val);
}

function colorHex(el, theme) {
    if (!el) return "";
    if (el.getAttribute("rgb")) return el.getAttribute("rgb").slice(-6).toUpperCase();
    if (el.getAttribute("theme") != null) return (theme[Number(el.getAttribute("theme"))] || "").toUpperCase();
    return "";
}

// 색조로 나눔: 주황 = 픽업, 초록 = 픽뚫(가루), 하늘·파랑 = 필그림·오버스펙, 보라 = 메모, 검정·회색 = 일반 픽뚫
export function colorKind(hex) {
    if (!hex) return "plain";
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (max < 0.2 || d / (max || 1) < 0.25) return "plain";
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h >= 15 && h < 50) return "pickup";
    if (h >= 70 && h < 170) return "dust";
    if (h >= 175 && h < 240) return "pilgrim";
    if (h >= 250 && h < 320) return "memo";
    return "unknown";
}

// ---------- 시트 읽기 ----------
const colOf = (ref) => [...ref.match(/^[A-Z]+/)[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const rowOf = (ref) => Number(ref.match(/\d+$/)[0]);

// 셀 하나 = 글자 조각들 [{ text, hex }] (한 칸 안에서도 이름마다 색이 다를 수 있음)
function runsOf(si, baseHex, theme) {
    const rs = kids(si, "r");
    if (!rs.length) return [{ text: kids(si, "t").map((t) => t.textContent).join(""), hex: baseHex }];
    return rs.map((r) => {
        const color = kid(kid(r, "rPr") || r, "color");
        return { text: kids(r, "t").map((t) => t.textContent).join(""), hex: color ? colorHex(color, theme) : baseHex };
    });
}

export async function readWorkbook(file) {
    const get = await unzip(await file.arrayBuffer());
    const [wb, rels, shared, styles, themeXml] = await Promise.all(["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/styles.xml", "xl/theme/theme1.xml"].map(get));
    const theme = themeColors(xml(themeXml));
    const st = xml(styles);
    const fonts = kids(all(st, "fonts")[0] || st.documentElement, "font").map((f) => colorHex(kid(f, "color"), theme));
    const xfFont = kids(all(st, "cellXfs")[0] || st.documentElement, "xf").map((x) => fonts[Number(x.getAttribute("fontId") || 0)] || "");
    const sis = kids(xml(shared).documentElement, "si");
    const target = new Map(all(xml(rels), "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));

    const sheets = [];
    for (const s of all(xml(wb), "sheet")) {
        const rid = [...s.attributes].find((a) => a.localName === "id")?.value;
        const path = `xl/${target.get(rid)}`.replace("xl//xl/", "xl/").replace("xl/xl/", "xl/");
        const doc = xml(await get(path));
        const cells = new Map();
        for (const c of all(doc, "c")) {
            const ref = c.getAttribute("r"), t = c.getAttribute("t");
            const base = xfFont[Number(c.getAttribute("s") || 0)] || "";
            const v = kid(c, "v")?.textContent;
            let runs;
            if (t === "s" && v != null) runs = runsOf(sis[Number(v)], base, theme);
            else if (t === "inlineStr") runs = runsOf(kid(c, "is"), base, theme);
            else if (v != null) runs = [{ text: v, hex: base }];
            else continue;
            cells.set(`${rowOf(ref)},${colOf(ref)}`, runs);
        }
        sheets.push({ name: s.getAttribute("name"), cells });
    }
    return sheets;
}

// ---------- 배너 블록 ----------
// 블록 4줄: [이름 | 10회 20회 ...] / [출시 타입 | 결과...] / [영문 | 모집 기간, 골티...] / 빈 줄
const SKIP_TOKEN = /^(x+|\d+회차|\d+회|골티.*|\d+장|\d+개|구매|[-·.]+)$/i;

export function parseBlocks(sheet) {
    const text = (r, c) => (sheet.cells.get(`${r},${c}`) || []).map((x) => x.text).join("").trim();
    const rows = [...new Set([...sheet.cells.keys()].map((k) => Number(k.split(",")[0])))].sort((a, b) => a - b);
    const blocks = [];
    for (const r of rows) {
        if (!/^10\s*회$/.test(text(r, 2)) || !text(r, 1)) continue;
        const slots = {};
        for (let c = 2; c < 400; c++) {
            const head = text(r, c).match(/^(\d+)\s*회$/);
            if (!head) { if (!text(r, c) && !text(r, c + 1)) break; continue; }
            const runs = sheet.cells.get(`${r + 1},${c}`);
            if (!runs) continue;
            const tokens = [];
            for (const run of runs) {
                const kind = colorKind(run.hex);
                if (kind === "memo") continue;
                for (const t of run.text.split(/\s+/)) if (t && !SKIP_TOKEN.test(t)) tokens.push({ text: t, kind });
            }
            if (tokens.length) slots[head[1]] = tokens;
        }
        blocks.push({ name: text(r, 1).replace(/\s+/g, " "), type: text(r + 1, 1), when: text(r + 2, 2), row: r, slots });
    }
    return blocks;
}

// 시트 이름 "1 케니", "7 키피" → 허브 계정 이름
export const sheetAccount = (name) => {
    const a = String(name).replace(/^\d+\s*/, "").trim();
    return a === "키피" ? "케니피" : a;
};
