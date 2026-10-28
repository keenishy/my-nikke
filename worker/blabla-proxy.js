// 블라블라 중계 서버 (Cloudflare Worker)
//
// 필요한 비밀값 (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets):
//   BLA_COOKIE  : 블라블라에 로그인한 브라우저의 cookie 헤더 값 전체 (기본 계정)
//   BLA_COOKIE_<유니온id> : (선택) 그 유니온 소속 계정의 cookie. 유니온 레이드·멤버는 소속 계정으로만 조회됨
//                    예: BLA_COOKIE_7811, BLA_COOKIE_22260, BLA_COOKIE_29131
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
      for (const k of Object.keys(env).filter((k) => /^BLA_COOKIE_\d+$/.test(k))) {
        extra[k] = codeOf(await calm(env, "game/proxy/Game/GetSavedRoleInfo", {}, env[k])) === 0 ? "ok" : "만료 또는 잘못됨";
      }
      return reply({ accounts: Object.keys(accounts), cookie: codeOf(me) === 0 ? "ok" : "만료 또는 잘못됨", union_cookies: extra });
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

    // 유니온 레이드·멤버는 로그인 계정이 속한 유니온만 보이므로, 유니온별 쿠키가 있으면 그걸 씀
    const guildCookie = (guild) => env[`BLA_COOKIE_${guild}`] || env.BLA_COOKIE;
    const notMember = (guild) => reply({ error: `이 유니온 소속 계정의 블라블라 쿠키가 필요합니다. Cloudflare에 BLA_COOKIE_${guild} 비밀값을 넣어 주세요.` }, 403);
    const expired = (guild) => reply({ error: `블라블라 로그인 쿠키가 만료됐습니다. ${env[`BLA_COOKIE_${guild}`] ? `BLA_COOKIE_${guild}` : "BLA_COOKIE"}를 다시 넣어 주세요.` }, 401);

    if (url.pathname === "/union-raid") {
      const guild = url.searchParams.get("guild");
      const season = url.searchParams.get("season");
      if (!/^\d+$/.test(guild || "") || !/^\d+$/.test(season || "")) return reply({ error: "guild, season 값이 필요합니다" }, 400);
      // 진행 중인 시즌은 다른 API를 씀 (블라블라 유니온 레이드 페이지와 같은 방식)
      const live = url.searchParams.get("live") === "1";
      const cookie = guildCookie(guild);
      const me = (cookie.match(/game_openid=(\d+)/) || [])[1] || Object.values(accounts)[0];
      const [raid, level] = live
        ? [await calm(env, "game/proxy/Game/GetUnionRaidData", { guild_id: guild, nikke_area_id: AREA, intl_open_id: me }, cookie),
           await calm(env, "game/proxy/Game/GetUnionRaidLevelInfo", { guild_id: guild, nikke_area_id: AREA, intl_open_id: me }, cookie)]
        : [await calm(env, "game/proxy/Game/GetUnionRaidDataOfGuildSeason", { area_id: AREA, guild_id: guild, season_id: season }, cookie),
           await calm(env, "game/proxy/Game/GetUnionRaidLevelDataOfGuildSeason", { area_id: AREA, guild_id: guild, season_id: season }, cookie)];
      if (codeOf(raid) === 1303028) return notMember(guild);
      if (codeOf(raid) === 300001) return expired(guild);
      if (codeOf(raid) !== 0) return reply({ error: "유니온 레이드 기록을 받지 못했습니다", detail: raid.slice(0, 300) }, 502);
      return reply(`{"guild":${JSON.stringify(guild)},"season":${JSON.stringify(season)},"fetched_at":${JSON.stringify(new Date().toISOString())},"raid":${raid},"level":${level}}`);
    }

    if (url.pathname === "/union-members") {
      const guild = url.searchParams.get("guild");
      if (!/^\d+$/.test(guild || "")) return reply({ error: "guild 값이 필요합니다" }, 400);
      const text = await calm(env, "game/proxy/Game/GetGuildMembers", { guild_id: guild, nikke_area_id: AREA }, guildCookie(guild));
      if (codeOf(text) === 1303028) return notMember(guild);
      if (codeOf(text) === 300001) return expired(guild);
      if (codeOf(text) !== 0) return reply({ error: "멤버 목록을 받지 못했습니다", detail: text.slice(0, 300) }, 502);
      const items = JSON.parse(text).data?.items || [];
      return reply({ guild, fetched_at: new Date().toISOString(),
        members: items.map((m) => ({ id: m.member_id, nick: m.nickname, level: m.level, synchro: m.synchro_level })) });
    }

    return reply({ error: "없는 주소입니다" }, 404);
  },
};
