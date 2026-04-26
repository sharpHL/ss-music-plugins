"use strict";
// ===================================================================
// 小宇宙 FM MusicFree 插件
// 实现思路: 抓取小宇宙 web 端 (xiaoyuzhoufm.com) 页面里嵌入的
//   __NEXT_DATA__ JSON,无需登录 token 即可拿到节目和单集数据。
// 上游 API ref: https://github.com/ultrazg/xyz
// 仓库: https://github.com/sharpHL/ss-music-plugins
//
// 功能范围:
//   ✓ 通过节目 URL 导入歌单(最新 15 集)
//   ✓ 通过单集 URL 导入单曲
//   ✓ 播放(直接拿 m4a CDN 地址)
//   ✗ 全文搜索(网页接口需要登录,暂不支持)
//   ✗ 翻页加载更早的单集(网页只内嵌最新 15 集)
// ===================================================================

const axios = require("axios");

const WEB_BASE = "https://www.xiaoyuzhoufm.com";
const WEB_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
};

const PID_RE = /[a-f0-9]{24}/i;

function extractNextData(html) {
    const m = html.match(
        /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/
    );
    if (!m) {
        throw new Error("无法解析小宇宙页面 (未找到 __NEXT_DATA__)");
    }
    return JSON.parse(m[1]);
}

async function fetchPodcast(pid) {
    const res = await axios.get(`${WEB_BASE}/podcast/${pid}`, {
        headers: WEB_HEADERS,
        timeout: 15000,
    });
    const data = extractNextData(res.data);
    const pod = data && data.props && data.props.pageProps && data.props.pageProps.podcast;
    if (!pod) throw new Error("节目不存在或已下架");
    return pod;
}

async function fetchEpisode(eid) {
    const res = await axios.get(`${WEB_BASE}/episode/${eid}`, {
        headers: WEB_HEADERS,
        timeout: 15000,
    });
    const data = extractNextData(res.data);
    const ep = data && data.props && data.props.pageProps && data.props.pageProps.episode;
    if (!ep) throw new Error("单集不存在或已下架");
    return ep;
}

function pickImage(img) {
    if (!img) return undefined;
    if (typeof img === "string") return img;
    return img.picUrl || img.largePicUrl || img.middlePicUrl || img.smallPicUrl || img.thumbnailUrl;
}

function podcastToSheet(pod) {
    return {
        id: pod.pid,
        title: pod.title,
        artist: pod.author || "",
        artwork: pickImage(pod.image),
        coverImg: pickImage(pod.image),
        description: pod.brief || pod.description || "",
        worksNum: pod.episodeCount,
        playCount: pod.subscriptionCount,
    };
}

function episodeToMusic(ep, podcast) {
    const pod = podcast || ep.podcast || {};
    const enclosureUrl = ep.enclosure && ep.enclosure.url;
    return {
        id: ep.eid,
        title: ep.title,
        artist: pod.author || "",
        album: pod.title || "",
        albumid: ep.pid || pod.pid,
        artwork: pickImage(ep.image) || pickImage(pod.image),
        url: enclosureUrl,
        duration: ep.duration,
        // keep originals for re-fetching later
        _eid: ep.eid,
        _pid: ep.pid || pod.pid,
        rawLrc: undefined,
    };
}

function parseUrlLike(input) {
    if (!input) return null;
    const s = String(input).trim();
    let m = s.match(/\/podcast\/([a-f0-9]{24})/i);
    if (m) return { kind: "podcast", id: m[1] };
    m = s.match(/\/episode\/([a-f0-9]{24})/i);
    if (m) return { kind: "episode", id: m[1] };
    // 直接粘贴 24 位 id
    if (/^[a-f0-9]{24}$/i.test(s)) return { kind: "podcast", id: s };
    return null;
}

module.exports = {
    platform: "小宇宙 FM",
    version: "0.1.0",
    author: "sharpHL",
    appVersion: ">=0.4.0-alpha.0",
    srcUrl:
        "https://raw.githubusercontent.com/sharpHL/ss-music-plugins/main/plugins/xiaoyuzhou.js",
    cacheControl: "no-cache",
    primaryKey: ["id", "_eid"],
    description:
        "小宇宙 FM 播客插件,通过网页版数据接入,无需登录。\n\n" +
        "**使用方式**\n" +
        "- 在小宇宙 App 或网页复制播客主页 URL,在 MusicFree 通过「导入歌单」粘贴\n" +
        "- 单集 URL 也可通过「导入单曲」粘贴\n\n" +
        "**当前限制**\n" +
        "- 不支持搜索(网页搜索接口需登录,后续考虑加 token)\n" +
        "- 每个节目暂只能取最新 15 集",

    hints: {
        importMusicSheet: [
            "粘贴小宇宙节目主页 URL,例如:",
            "https://www.xiaoyuzhoufm.com/podcast/626b46ea9cbbf0451cf5a962",
            "导入后即可看到该节目的最新 15 集。",
        ],
        importMusicItem: [
            "粘贴小宇宙单集 URL,例如:",
            "https://www.xiaoyuzhoufm.com/episode/66090a2c1519139e4fa97f99",
        ],
    },

    supportedSearchType: ["sheet"],

    async search(query, page, type) {
        // 网页搜索接口要登录,暂返回空。后续若加 token 支持可在此实现
        return { isEnd: true, data: [] };
    },

    async importMusicSheet(urlLike) {
        const parsed = parseUrlLike(urlLike);
        if (!parsed || parsed.kind !== "podcast") {
            throw new Error(
                "请粘贴小宇宙节目主页 URL,如 https://www.xiaoyuzhoufm.com/podcast/<pid>"
            );
        }
        const pod = await fetchPodcast(parsed.id);
        const eps = pod.episodes || [];
        return eps.map(function (e) {
            return episodeToMusic(e, pod);
        });
    },

    async importMusicItem(urlLike) {
        const parsed = parseUrlLike(urlLike);
        if (!parsed || parsed.kind !== "episode") {
            throw new Error(
                "请粘贴小宇宙单集 URL,如 https://www.xiaoyuzhoufm.com/episode/<eid>"
            );
        }
        const ep = await fetchEpisode(parsed.id);
        return episodeToMusic(ep, ep.podcast);
    },

    async getMediaSource(musicItem, quality) {
        if (musicItem && musicItem.url) {
            return { url: musicItem.url };
        }
        const eid = (musicItem && (musicItem._eid || musicItem.id)) || "";
        if (!PID_RE.test(eid)) return null;
        const ep = await fetchEpisode(eid);
        const url = ep.enclosure && ep.enclosure.url;
        return url ? { url } : null;
    },

    async getMusicInfo(musicBase) {
        const eid = musicBase && (musicBase._eid || musicBase.id);
        if (!eid) return null;
        const ep = await fetchEpisode(eid);
        return episodeToMusic(ep, ep.podcast);
    },

    async getAlbumInfo(albumItem, page) {
        // 网页版仅暴露最新 15 集,翻页直接返回 isEnd
        if (page > 1) {
            return { isEnd: true, musicList: [] };
        }
        const pid = albumItem && albumItem.id;
        if (!pid) return null;
        const pod = await fetchPodcast(pid);
        const eps = pod.episodes || [];
        const sheet = podcastToSheet(pod);
        return Object.assign({}, sheet, {
            isEnd: true,
            musicList: eps.map(function (e) {
                return episodeToMusic(e, pod);
            }),
        });
    },

    async getMusicSheetInfo(sheet, page) {
        return this.getAlbumInfo(sheet, page);
    },
};
