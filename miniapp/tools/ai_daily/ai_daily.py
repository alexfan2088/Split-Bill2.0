#!/usr/bin/env python3
"""Build and send the daily AI news email via the logged-in Gmail web UI."""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path.home() / ".codex" / "ai_daily"
OUT_DIR = DATA_DIR / "out"
STATE_PATH = DATA_DIR / "sent_urls.json"
RECIPIENTS = ["alexfan2088@gmail.com", "1394628250@qq.com"]
SUBJECT = "AI 日日观"

FEEDS = [
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "https://venturebeat.com/category/ai/feed/",
    "https://www.artificialintelligence-news.com/feed/",
    "https://blog.google/technology/ai/rss/",
    "https://blog.google/products/gemini/rss/",
    "https://blogs.nvidia.com/blog/category/generative-ai/feed/",
    "https://www.therobotreport.com/feed/",
    "https://spectrum.ieee.org/rss/robotics/fulltext",
    "https://openai.com/news/rss.xml",
]

NEWS_SEARCHES = [
    "OpenAI Anthropic Google xAI AI",
    "Alibaba Qwen ByteDance Doubao Tencent Zhipu AI",
    "China AI Qwen Doubao Yuanbao GLM DeepSeek Kimi",
    "Figure AI Tesla Optimus Unitree humanoid robot NVIDIA robotics",
    "AI agents enterprise model funding valuation robotics",
]

COMPANY_KEYWORDS = [
    "openai",
    "anthropic",
    "claude",
    "google",
    "gemini",
    "deepmind",
    "xai",
    "grok",
    "musk",
    "nvidia",
    "qwen",
    "alibaba",
    "doubao",
    "bytedance",
    "tencent",
    "zhipu",
    "glm",
    "deepseek",
    "moonshot",
    "kimi",
    "robot",
    "robotics",
    "humanoid",
    "figure",
    "optimus",
    "tesla",
    "unitree",
    "apptronik",
    "agility",
    "1x",
]


def log(message: str) -> None:
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {message}", flush=True)


def fetch_url(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 AI-Daily/1.0",
            "Accept": "application/rss+xml, application/xml, text/xml, text/html, application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def parse_date(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime.now(dt.UTC)
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.UTC)
        return parsed.astimezone(dt.UTC)
    except Exception:
        return dt.datetime.now(dt.UTC)


def text_of(node: ET.Element, names: list[str]) -> str:
    for name in names:
        found = node.find(name)
        if found is not None and found.text:
            return clean_text(found.text)
    for child in node:
        tag = child.tag.rsplit("}", 1)[-1].lower()
        if tag in {n.lower() for n in names} and child.text:
            return clean_text(child.text)
    return ""


def clean_text(value: str) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", " ", value))
    return re.sub(r"\s+", " ", value).strip()


def title_key(title: str) -> str:
    lower = title.lower()
    if ("claude" in lower or "anthropic" in lower) and "opus" in lower and "4.8" in lower:
        return "claude opus 4.8"
    if "openrouter" in lower and "raises" in lower:
        return "openrouter raises"
    if "genesis ai" in lower and "robotics" in lower:
        return "genesis ai robotics"
    title = re.sub(r"\s+-\s+[^-]+$", "", title)
    title = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", title.lower())
    words = [w for w in title.split() if w not in {"the", "a", "an", "to", "and", "of", "as", "for"}]
    return " ".join(words[:10])


def parse_feed(content: bytes, source_url: str) -> list[dict]:
    items: list[dict] = []
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return items

    nodes = root.findall(".//item")
    if not nodes:
        nodes = root.findall(".//{http://www.w3.org/2005/Atom}entry")

    for node in nodes:
        title = text_of(node, ["title"])
        summary = text_of(node, ["description", "summary", "content"])
        link = text_of(node, ["link"])
        if not link:
            for child in node:
                if child.tag.rsplit("}", 1)[-1].lower() == "link":
                    link = child.attrib.get("href", "")
                    break
        published = parse_date(text_of(node, ["pubDate", "published", "updated"]))
        if title and link:
            items.append(
                {
                    "title": title,
                    "summary": summary,
                    "url": link,
                    "published": published.isoformat(),
                    "source": urllib.parse.urlparse(source_url).netloc,
                }
            )
    return items


def fetch_hn_ai() -> list[dict]:
    since = int((dt.datetime.now(dt.UTC) - dt.timedelta(days=3)).timestamp())
    query = urllib.parse.urlencode(
        {
            "query": "AI OR OpenAI OR Anthropic OR Gemini OR robot OR robotics",
            "tags": "story",
            "numericFilters": f"created_at_i>{since}",
        }
    )
    url = f"https://hn.algolia.com/api/v1/search_by_date?{query}"
    try:
        data = json.loads(fetch_url(url).decode("utf-8"))
    except Exception as exc:
        log(f"HN fetch failed: {exc}")
        return []
    items = []
    for hit in data.get("hits", []):
        title = clean_text(hit.get("title") or hit.get("story_title") or "")
        link = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
        if title and link:
            items.append(
                {
                    "title": title,
                    "summary": f"Hacker News 近期讨论热度较高，评论数 {hit.get('num_comments', 0)}。",
                    "url": link,
                    "published": parse_date(hit.get("created_at")).isoformat(),
                    "source": "news.ycombinator.com",
                }
            )
    return items


def google_news_rss_url(query: str) -> str:
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {
            "q": f"{query} when:3d",
            "hl": "en-US",
            "gl": "US",
            "ceid": "US:en",
        }
    )


def score_item(item: dict) -> int:
    text = f"{item.get('title', '')} {item.get('summary', '')}".lower()
    score = 0
    for keyword in COMPANY_KEYWORDS:
        if keyword in text:
            score += 5
    for keyword in [
        "launch",
        "release",
        "raise",
        "funding",
        "valuation",
        "agent",
        "model",
        "robot",
        "chip",
        "qwen",
        "doubao",
        "zhipu",
        "tencent",
    ]:
        if keyword in text:
            score += 3
    if any(k in text for k in ["video friday", "guide to", "event calendar", "webinar"]):
        score -= 8
    try:
        age = dt.datetime.now(dt.UTC) - dt.datetime.fromisoformat(item["published"])
        score += max(0, 10 - int(age.total_seconds() // 86400))
    except Exception:
        pass
    return score


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"sent_urls": []}
    try:
        return json.loads(STATE_PATH.read_text("utf-8"))
    except Exception:
        return {"sent_urls": []}


def save_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    urls = list(dict.fromkeys(state.get("sent_urls", [])))[-500:]
    STATE_PATH.write_text(json.dumps({"sent_urls": urls}, ensure_ascii=False, indent=2), "utf-8")


def collect_items() -> list[dict]:
    collected: list[dict] = []
    for feed in FEEDS:
        try:
            collected.extend(parse_feed(fetch_url(feed), feed))
        except Exception as exc:
            log(f"Feed failed: {feed}: {exc}")
    for query in NEWS_SEARCHES:
        feed = google_news_rss_url(query)
        try:
            collected.extend(parse_feed(fetch_url(feed), feed))
        except Exception as exc:
            log(f"News search failed: {query}: {exc}")
    collected.extend(fetch_hn_ai())

    seen = set()
    seen_titles = set()
    unique = []
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(days=3)
    for item in collected:
        url = item["url"].split("#", 1)[0]
        if url in seen:
            continue
        key = title_key(item["title"])
        if key and key in seen_titles:
            continue
        try:
            published = dt.datetime.fromisoformat(item["published"])
        except Exception:
            published = dt.datetime.now(dt.UTC)
        if published < cutoff:
            continue
        text = f"{item['title']} {item.get('summary', '')}".lower()
        if " ai " not in f" {text} " and not any(k in text for k in COMPANY_KEYWORDS):
            continue
        seen.add(url)
        if key:
            seen_titles.add(key)
        item["url"] = url
        item["score"] = score_item(item)
        unique.append(item)
    return sorted(unique, key=lambda x: x["score"], reverse=True)


def ensure_robotics(items: list[dict], selected: list[dict]) -> None:
    if any(any(k in f"{i['title']} {i.get('summary', '')}".lower() for k in ["robot", "humanoid", "figure", "optimus", "unitree"]) for i in selected):
        return
    for item in items:
        text = f"{item['title']} {item.get('summary', '')}".lower()
        if any(k in text for k in ["robot", "humanoid", "figure", "optimus", "unitree"]):
            if item not in selected:
                selected[-1] = item
            return


def ensure_china_ai(items: list[dict], selected: list[dict]) -> None:
    china_terms = ["qwen", "alibaba", "doubao", "bytedance", "tencent", "zhipu", "glm", "deepseek", "kimi", "yuanbao"]
    if any(any(k in f"{i['title']} {i.get('summary', '')}".lower() for k in china_terms) for i in selected):
        return
    for item in items:
        text = f"{item['title']} {item.get('summary', '')}".lower()
        if any(k in text for k in china_terms):
            if item not in selected:
                selected[-1] = item
            return


def select_items(items: list[dict]) -> list[dict]:
    state = load_state()
    sent = set(state.get("sent_urls", []))
    fresh = [item for item in items if item["url"] not in sent]
    selected = fresh[:10]
    if len(selected) < 10:
        for item in items:
            if item not in selected:
                selected.append(item)
            if len(selected) == 10:
                break
    ensure_robotics(items, selected)
    ensure_china_ai(items, selected)
    return selected[:10]


def stars(item: dict, index: int) -> str:
    if index < 4 or item.get("score", 0) >= 18:
        return "★★★★★"
    if index < 8 or item.get("score", 0) >= 12:
        return "★★★★☆"
    return "★★★☆☆"


def chinese_summary(item: dict, index: int) -> str:
    title = item["title"]
    summary = item.get("summary", "")
    source = item.get("source", "公开来源")
    if len(summary) > 260:
        summary = summary[:260].rstrip() + "..."
    templates = [
        "这条值得排在前面，因为它直接反映了 AI 公司从模型演示走向商业化、企业采购和平台能力竞争的趋势。",
        "它的核心看点不是单个功能，而是背后的生态位变化：入口、算力、开发者工具和付费场景正在重新组合。",
        "如果后续能持续落地，这类进展会影响企业选择模型供应商、开发者构建 Agent，以及普通用户日常使用 AI 的方式。",
        "短期可以看产品反馈和客户采用速度，长期则要看成本、稳定性、监管和能否形成可持续收入。",
    ]
    base = templates[index % len(templates)]
    if summary:
        return f"{base} 来源摘要显示：{summary}"
    return f"{base} 目前公开标题为“{title}”，来源为 {source}，后续需要继续观察官方公告、客户案例和行业复盘。"


def build_body(items: list[dict]) -> str:
    today = dt.datetime.now().strftime("%Y-%m-%d")
    intro = (
        f"本期采集窗口：最近 3 天，生成日期：{today}。\n\n"
        "简介：\n"
        "今天的 AI 圈继续呈现一个很清楚的变化：行业不再只围绕“谁的模型分数最高”展开竞争，而是进入模型、算力、入口、Agent、企业合同和机器人落地同时推进的阶段。"
        "OpenAI、Anthropic、Google 这些前沿实验室仍然决定能力上限，但真正影响商业格局的，越来越多是推理成本、可用容量、企业集成、数据合规和产品分发。"
        "如果一家 AI 公司只有强模型，却没有稳定算力和明确付费场景，它很难支撑长期高估值；如果一家大平台能把 AI 嵌入搜索、浏览器、手机、办公、电商和开发工具，它就可能把 AI 变成默认入口。"
        "中国 AI 公司也在从模型发布和价格战，转向云服务、Agent 平台、消费生态和出海能力的综合竞争。阿里 Qwen、字节豆包、腾讯元宝、智谱 GLM、DeepSeek、Kimi 等产品背后的关键问题，是能否从“用户尝鲜”走到“每天高频使用”，再走到企业愿意长期付费。"
        "机器人方向同样值得放进每日观察，因为它正在把大模型从屏幕带到物理世界。Figure、Tesla Optimus、1X、Apptronik、Agility、Unitree、NVIDIA GR00T 等公司的进展，短期看像演示视频，长期看却是制造、仓储、家庭服务和具身智能基础设施的竞争。"
        "所以本邮件每天会优先筛选三类信号：一是会影响行业格局的商业和资本事件；二是会改变开发者或企业工作流的技术产品；三是会把 AI 带入现实生产场景的机器人、芯片和基础设施进展。\n"
    )
    lines = ["AI 日日观", "", intro]
    for idx, item in enumerate(items, 1):
        lines.extend(
            [
                "",
                f"{idx}. {item['title']}",
                f"推荐指数：{stars(item, idx - 1)}",
                chinese_summary(item, idx - 1),
                "链接：",
                item["url"],
            ]
        )
    lines.extend(
        [
            "",
            "今日结论：",
            "AI 竞争正在从单点模型能力转向系统能力。每天真正值得盯的，不只是某个模型又刷新了哪个榜单，而是谁能把 AI 稳定地接入真实业务、真实设备和真实收入。后续如果某条新闻连续多天发酵，本邮件会优先追踪新增信息，避免重复搬运同一条旧链接。",
        ]
    )
    return "\n".join(lines)


def compose_gmail_url() -> str:
    params = {
        "view": "cm",
        "fs": "1",
        "to": ",".join(RECIPIENTS),
        "su": SUBJECT,
    }
    return "https://mail.google.com/mail/?" + urllib.parse.urlencode(params)


def run_osascript(script: str) -> None:
    result = subprocess.run(["osascript", "-e", script], text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())


def send_via_gmail(body_path: Path) -> None:
    url = compose_gmail_url()
    body_posix = str(body_path)
    escaped_url = url.replace('"', '\\"')
    escaped_path = body_posix.replace('"', '\\"')
    script = f'''
tell application "Google Chrome"
  activate
  open location "{escaped_url}"
end tell
delay 8
set bodyText to read POSIX file "{escaped_path}" as «class utf8»
set the clipboard to bodyText
tell application "System Events"
  set frontmost of process "Google Chrome" to true
  delay 1
  keystroke "v" using {{command down}}
  delay 2
  key code 36 using {{command down}}
end tell
delay 5
'''
    run_osascript(script)


def write_body(body: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"ai_daily_{dt.datetime.now().strftime('%Y-%m-%d')}.txt"
    path.write_text(body, "utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--send", action="store_true", help="Send the generated email through Gmail web.")
    parser.add_argument("--dry-run", action="store_true", help="Generate only and print the output path.")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log("Collecting AI news")
    items = collect_items()
    if len(items) < 10:
        log(f"Only collected {len(items)} eligible items; continuing with available items")
    selected = select_items(items)
    if not selected:
        raise RuntimeError("No AI news items collected.")

    body_path = write_body(build_body(selected))
    log(f"Wrote {body_path}")

    if args.send:
        log("Sending through Gmail web")
        send_via_gmail(body_path)
        state = load_state()
        state["sent_urls"] = list(dict.fromkeys(state.get("sent_urls", []) + [i["url"] for i in selected]))
        save_state(state)
        log("Send command completed")
    elif args.dry_run:
        print(body_path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"ERROR: {exc}")
        raise
