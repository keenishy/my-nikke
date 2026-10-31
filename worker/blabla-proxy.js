// 블라블라 중계 서버 (Cloudflare Worker)
//
// 필요한 비밀값 (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets):
//   BLA_COOKIE  : 블라블라에 로그인한 브라우저의 cookie 헤더 값 전체 (기본 계정)
//   (선택) 다른 계정 cookie를 이름 상관없이 더 넣을 수 있음 (예: pano, Smiley4)
//          유니온 레이드·멤버는 소속 계정으로만 조회되므로, 넣어 둔 cookie를 차례로 시도해 맞는 걸 씀
//   ACCOUNTS    : {"계정이름":"1234567890", ...}  (계정 이름 → openid 숫자)
//   ACCESS_KEY  : 아무 긴 문자열. 허브가 요청할 때 ?key= 로 같이 보냄
//
// 사용법:
//   GET /?key=...                → 등록된 계정 이름 목록 + 쿠키 상태
//   GET /sync?key=...&acc=케니    → 그 계정의 니케 목록·육성 상세·전초기지 원본
//   GET /unions?key=...           → 계정별 소속 유니온(gsn)과 유니온 공개 정보
//   GET /union-raid?key=...&guild=1964&season=1000045[&live=1]
//                                 → 유니온 레이드 시즌 기록 (로그인 쿠키 계정이 속한 유니온만 받을 수 있음)
//   GET /union-members?key=...&guild=1964 → 유니온 전체 멤버 (닉네임·레벨·싱크로, 같은 제한)

const API = "https://api.blablalink.com/api/";
const AREA = 83; // 한국 서버
const VERSION = "2026-10-31b"; // 허브에서 배포된 코드가 최신인지 확인용
const COMMON = { game_id: "29080", area_id: "global", source: "pc_web", intl_game_id: "29080", language: "ko", env: "prod" };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const reply = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: cors });

async function post(env, path, body, cookie = env.BLA_COOKIE) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Channel-Type": "2",
      "X-Language": "ko",
      "X-Common-Params": JSON.stringify(COMMON),
      "Origin": "https://www.blablalink.com",
      "Referer": "https://www.blablalink.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Cookie": cookie,
    },
    body: JSON.stringify(body),
  });
  return r.text();
}

// 응답 코드만 빠르게 확인 (본문 전체를 파싱하지 않아 CPU 시간을 아낌)
const codeOf = (text) => {
  const m = text.match(/"code":(-?\d+)/);
  return m ? Number(m[1]) : -1;
};

// 블라블라는 동시 요청을 "request too frequently"(212000)로 거절하므로 하나씩 보내고, 거절되면 잠깐 쉬었다 재시도
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function calm(env, path, body, cookie) {
  for (let tries = 0; ; tries++) {
    await sleep(300);
    const text = await post(env, path, body, cookie);
    if (codeOf(text) !== 212000 || tries >= 4) return text;
    await sleep(1000 * (tries + 1));
  }
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(req.url);
    if (!env.ACCESS_KEY || url.searchParams.get("key") !== env.ACCESS_KEY) return reply({ error: "key가 맞지 않습니다" }, 403);

    let accounts;
    try { accounts = JSON.parse(env.ACCOUNTS || "{}"); } catch { return reply({ error: "ACCOUNTS 비밀값 형식이 잘못됐습니다" }, 500); }

    if (url.pathname === "/") {
      const me = await post(env, "game/proxy/Game/GetSavedRoleInfo", {});
      const extra = {};
      for (const [k, v] of Object.entries(env)) {
        if (k === "BLA_COOKIE" || typeof v !== "string" || !v.includes("game_token=")) continue;
        extra[k] = codeOf(await calm(env, "game/proxy/Game/GetSavedRoleInfo", {}, v)) === 0 ? "ok" : "만료 또는 잘못됨";
      }
      return reply({ version: VERSION, accounts: Object.keys(accounts), cookie: codeOf(me) === 0 ? "ok" : "만료 또는 잘못됨", union_cookies: extra });
    }

    if (url.pathname === "/sync") {
      const name = url.searchParams.get("acc");
      const openid = accounts[name];
      if (!openid) return reply({ error: `등록되지 않은 계정: ${name}` }, 404);
      const who = { intl_open_id: openid, nikke_area_id: AREA };

      const chars = await post(env, "game/proxy/Game/GetUserCharacters", who);
      const code = codeOf(chars);
      if (code === 300001) return reply({ error: "블라블라 로그인 쿠키가 만료됐습니다. BLA_COOKIE를 다시 넣어 주세요." }, 401);
      if (code !== 0) return reply({ error: "니케 목록을 받지 못했습니다", detail: chars.slice(0, 300) }, 502);

      const codes = JSON.parse(chars).data.characters.map((c) => c.name_code);
      const details = [];
      for (let i = 0; i < codes.length; i += 60) {
        const text = await calm(env, "game/proxy/Game/GetUserCharacterDetails", { ...who, name_codes: codes.slice(i, i + 60) });
        if (codeOf(text) !== 0) return reply({ error: "육성 상세를 받지 못했습니다. 잠시 후 다시 시도해 주세요.", detail: text.slice(0, 300) }, 502);
        details.push(text);
      }
      const outpost = await calm(env, "game/proxy/Game/GetUserProfileOutpostInfo", who);

      // 받은 원본 그대로 이어 붙여서 돌려줌 (정리는 허브 쪽에서)
      return reply(`{"account":${JSON.stringify(name)},"fetched_at":${JSON.stringify(new Date().toISOString())},"characters":${chars},"details":[${details.join(",")}],"outpost":${outpost}}`);
    }

    if (url.pathname === "/unions") {
      // 계정 프로필의 gsn = 소속 유니온 id
      const members = {};
      for (const [name, openid] of Object.entries(accounts)) {
        const text = await calm(env, "game/proxy/Game/GetUserProfileBasicInfo", { intl_open_id: openid, nikke_area_id: AREA });
        if (codeOf(text) === 300001) return reply({ error: "블라블라 로그인 쿠키가 만료됐습니다. BLA_COOKIE를 다시 넣어 주세요." }, 401);
        members[name] = JSON.parse(text).data?.basic_info?.gsn || "";
      }
      const unions = {};
      for (const gid of new Set(Object.values(members).filter(Boolean))) {
        const d = JSON.parse(await calm(env, "game/proxy/Game/GetGuildDetail", { guild_id: gid, nikke_area_id: AREA })).data?.guild_detail || {};
        unions[gid] = {
          name: d.guild_name, level: d.guild_level, members: d.guild_member_cnt, max: d.guild_member_max_cnt,
          ranking: d.ranking, ranking_percent: d.ranking_percent, activity: d.guild_activity, is_member: d.is_member,
          synchro: d.synchro_level_distribution || [],
        };
      }
      return reply({ fetched_at: new Date().toISOString(), members, unions });
    }

    // 유니온 레이드·멤버는 로그인 계정이 속한 유니온만 보이므로, 넣어 둔 쿠키를 차례로 시도
    // (이 유니온에서 성공한 쿠키를 앞에 두기 위해 BLA_COOKIE_<유니온id> 이름이 있으면 먼저 씀)
    const cookieCandidates = (guild) => {
      const all = Object.entries(env).filter(([k, v]) => typeof v === "string" && v.includes("game_token="));
      const named = all.filter(([k]) => k === `BLA_COOKIE_${guild}`);
      const rest = all.filter(([k]) => k !== `BLA_COOKIE_${guild}` && k !== "BLA_COOKIE");
      const base = all.filter(([k]) => k === "BLA_COOKIE");
      return [...named, ...rest, ...base];
    };
    // 쿠키 주인(game_openid)의 소속 유니온 id
    const ownerGuild = async (cookie) => {
      const me = (cookie.match(/game_openid=(\d+)/) || [])[1];
      if (!me) return "";
      const text = await calm(env, "game/proxy/Game/GetUserProfileBasicInfo", { intl_open_id: me, nikke_area_id: AREA }, cookie);
      return String(JSON.parse(text).data?.basic_info?.gsn || "");
    };
    // fn(cookie) 결과가 "유니온 소속 아님"이 아닐 때까지 쿠키를 바꿔 가며 시도
    // ownerOnly: 진행 중 시즌 API는 guild_id와 상관없이 쿠키 주인의 유니온 기록을 돌려주므로, 그 유니온 소속 쿠키만 씀
    async function withGuildCookie(guild, fn, ownerOnly = false) {
      let expiredName = "";
      const tried = [];
      for (const [name, cookie] of cookieCandidates(guild)) {
        let owner = "";
        if (ownerOnly) {
          try { owner = await ownerGuild(cookie); } catch {}
          tried.push(`${name}→${owner || "?"}`);
          if (owner !== guild) continue;
        }
        const result = await fn(cookie);
        const code = codeOf(result[0]);
        if (code === 1303028) continue;
        if (code === 300001) { expiredName ||= name; continue; }
        return { result, name, owner };
      }
      return { error: expiredName
        ? reply({ error: `블라블라 로그인 쿠키(${expiredName})가 만료됐습니다. 그 계정 쿠키를 다시 넣어 주세요.` }, 401)
        : reply({ error: `이 유니온 소속 계정의 블라블라 쿠키가 없습니다. 그 유니온 계정으로 로그인한 쿠키를 Cloudflare 비밀값에 추가해 주세요.${tried.length ? ` (확인한 쿠키→소속 유니온: ${tried.join(", ")})` : ""}` }, 403) };
    }

    if (url.pathname === "/union-raid") {
      const guild = url.searchParams.get("guild");
      const season = url.searchParams.get("season");
      if (!/^\d+$/.test(guild || "") || !/^\d+$/.test(season || "")) return reply({ error: "guild, season 값이 필요합니다" }, 400);
      // 진행 중인 시즌은 다른 API를 씀 (블라블라 유니온 레이드 페이지와 같은 방식)
      const live = url.searchParams.get("live") === "1";
      const got = await withGuildCookie(guild, async (cookie) => {
        const me = (cookie.match(/game_openid=(\d+)/) || [])[1] || Object.values(accounts)[0];
        const first = live
          ? await calm(env, "game/proxy/Game/GetUnionRaidData", { guild_id: guild, nikke_area_id: AREA, intl_open_id: me }, cookie)
          : await calm(env, "game/proxy/Game/GetUnionRaidDataOfGuildSeason", { area_id: AREA, guild_id: guild, season_id: season }, cookie);
        if (codeOf(first) !== 0) return [first];
        const second = live
          ? await calm(env, "game/proxy/Game/GetUnionRaidLevelInfo", { guild_id: guild, nikke_area_id: AREA, intl_open_id: me }, cookie)
          : await calm(env, "game/proxy/Game/GetUnionRaidLevelDataOfGuildSeason", { area_id: AREA, guild_id: guild, season_id: season }, cookie);
        return [first, second];
      }, live);
      if (got.error) return got.error;
      const [raid, level] = got.result;
      if (codeOf(raid) !== 0) return reply({ error: "유니온 레이드 기록을 받지 못했습니다", detail: raid.slice(0, 300) }, 502);
      return reply(`{"version":${JSON.stringify(VERSION)},"via":${JSON.stringify(got.name)},"via_guild":${JSON.stringify(got.owner)},"guild":${JSON.stringify(guild)},"season":${JSON.stringify(season)},"fetched_at":${JSON.stringify(new Date().toISOString())},"raid":${raid},"level":${level}}`);
    }

    if (url.pathname === "/union-members") {
      const guild = url.searchParams.get("guild");
      if (!/^\d+$/.test(guild || "")) return reply({ error: "guild 값이 필요합니다" }, 400);
      const got = await withGuildCookie(guild, async (cookie) => [await calm(env, "game/proxy/Game/GetGuildMembers", { guild_id: guild, nikke_area_id: AREA }, cookie)]);
      if (got.error) return got.error;
      const [text] = got.result;
      if (codeOf(text) !== 0) return reply({ error: "멤버 목록을 받지 못했습니다", detail: text.slice(0, 300) }, 502);
      const items = JSON.parse(text).data?.items || [];
      return reply({ guild, fetched_at: new Date().toISOString(),
        members: items.map((m) => ({ id: m.member_id, nick: m.nickname, level: m.level, synchro: m.synchro_level })) });
    }

    return reply({ error: "없는 주소입니다" }, 404);
  },
};
