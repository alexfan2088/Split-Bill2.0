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
RECIPIENTS = [
    "1394628250@qq.com",
    "1347191150@qq.com",
    "376622979@qq.com",
    "fanjy12@chinatelecom.cn",
]
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

GLOSSARY_TERMS = [
    {
        "term": "模型治理",
        "aliases": ["model governance", "governance", "治理", "合规", "安全"],
        "body": [
            "模型治理就是管理 AI 模型从设计、训练、上线、使用到下线的全过程。",
            "通俗说，不是只看模型会不会回答，而是要管它能不能安全用、谁能用、用在哪里、出了问题谁负责、数据有没有泄露、结果能不能追溯。",
            "例如企业用了一个 AI 客服模型，模型治理要管：训练数据是否合法、有没有客户隐私；模型会不会泄露内部资料；回答准确率和幻觉率怎么样；哪些员工能调用；能不能访问敏感系统；谁问了什么、模型答了什么、日志能不能查；模型出错后怎么回滚、降级和人工接管。",
            "生活类比：模型就像一个新员工，模型治理就是公司的制度、权限、考核、监督和问责机制。",
        ],
    },
    {
        "term": "Gemini Flash",
        "aliases": ["gemini flash", "gemini", "flash"],
        "body": [
            "Gemini Flash 是 Google Gemini 系列里偏速度和成本效率的模型路线，通常适合高频调用、长流程任务、Agent、代码和文档处理等场景。",
            "你可以把它理解为一个又快又省钱、适合干活的 AI 大脑。它不一定在每个难题上都比旗舰模型强，但在响应速度、调用成本和规模化使用上更适合产品落地。",
            "它常见的使用场景包括：快速总结大量文档、辅助写代码、处理客服和运营任务、调用工具完成多步骤流程，以及作为 Agent 系统里的执行型模型。",
            "生活类比：Pro 模型像顶级专家，Flash 模型像效率很高的高级工程师，不一定每个问题都最强，但能又快又稳地处理大量工作。",
        ],
    },
    {
        "term": "Agent",
        "aliases": ["agent", "agents", "智能体", "agentic"],
        "body": [
            "Agent 可以翻译成智能体，意思是一个不只会回答问题，还能围绕目标持续执行任务的 AI 系统。",
            "普通聊天机器人通常是你问一句、它答一句；Agent 则可以自己拆解任务、调用工具、读取文件、浏览网页、写代码、运行命令、检查结果，然后继续下一步。",
            "一个典型 Agent 系统通常包含：大模型大脑、工具调用能力、记忆或状态、权限控制、任务规划、执行环境和日志审计。",
            "生活类比：普通 AI 像顾问，Agent 像助理。顾问给建议，助理会拿着目标去查资料、填表、发邮件、跑流程，并把结果交回来。",
        ],
    },
    {
        "term": "Managed Agents",
        "aliases": ["managed agents", "托管智能体", "managed agent"],
        "body": [
            "Managed Agents 可以翻译为托管智能体，意思是平台已经帮你把 Agent 的运行环境搭好。",
            "你不用自己配置服务器、文件系统、沙箱、工具权限、状态保存和日志系统，只需要告诉 Agent 要完成什么任务，以及允许它使用哪些工具和数据。",
            "它通常包含模型、工具调用、文件系统、沙箱环境、状态管理、权限控制、版本管理和日志审计。",
            "生活类比：自己做 Agent 像自己招人、租办公室、买电脑、装软件；Managed Agents 像平台已经提供办公区和电脑，你只需要告诉 AI 员工干什么。",
        ],
    },
    {
        "term": "AI Search",
        "aliases": ["ai search", "search", "ai mode", "搜索"],
        "body": [
            "AI Search 就是用 AI 改造搜索。",
            "传统搜索是你输入关键词，搜索引擎返回一堆网页链接；AI Search 是你输入问题，AI 先理解问题，再搜索和读取资料，最后直接整理出答案，还能继续追问。",
            "例如你问 6 月去新疆自驾，那拉提、赛里木湖、独库公路怎么预约，传统搜索会给很多网页；AI Search 会尝试直接整理预约入口、预约时间、自驾限制和注意事项。",
            "它的风险也很明显：可能总结错、漏掉来源、过度个性化，或者影响原网页流量。所以好的 AI Search 必须保留出处链接和可核查信息。",
        ],
    },
    {
        "term": "token",
        "aliases": ["token", "tokens", "上下文", "context"],
        "body": [
            "token 是大模型处理文字的基本单位。它不严格等于字，也不严格等于词。",
            "中文里，一个汉字可能接近一个 token；英文里，一个单词可能被拆成一个或多个 token。模型会先把文字切成 token，再进行计算。",
            "token 主要影响三件事：上下文长度，也就是模型一次能读多少内容；费用，也就是 API 通常按输入和输出 token 收费；速度，也就是 token 越多处理越慢、成本越高。",
            "一句话总结：token 是 AI 的文字燃料；上下文窗口是 AI 一次能装多少燃料和材料；价格通常按消耗多少 token 计算。",
        ],
    },
    {
        "term": "大模型上下文窗口",
        "aliases": ["context window", "上下文窗口", "100万 token", "million token"],
        "body": [
            "上下文窗口指模型一次能读进去并用于思考的内容长度。",
            "如果上下文窗口很小，模型只能看短对话或短文档；如果上下文窗口很大，模型就能同时处理长报告、代码库、多份合同或连续对话记录。",
            "但上下文越大不代表一定越好。内容越多，费用和延迟通常越高，也更考验模型能不能从大量材料里抓住真正重要的信息。",
            "生活类比：上下文窗口像办公桌。桌子越大，可以同时摊开的资料越多；但资料太乱，哪怕桌子很大，也可能找不到重点。",
        ],
    },
    {
        "term": "机器人基础模型",
        "aliases": ["robotics foundation model", "robot foundation model", "机器人", "humanoid", "physical ai", "具身智能"],
        "body": [
            "机器人基础模型是把大模型能力用于物理世界的模型，让机器人理解环境、规划动作、操作物体并适应新任务。",
            "传统机器人常常为某个固定动作写死程序，例如抓取、搬运、焊接；机器人基础模型希望机器人能通过视觉、语言和动作数据学习，面对新物体和新环境也能完成任务。",
            "它通常需要仿真训练、真实机器人数据、视觉模型、动作控制模型和安全机制一起配合。",
            "生活类比：传统机器人像只会一道菜的机器厨师；机器人基础模型像受过训练的学徒，能看菜谱、观察食材、试着调整步骤，但还需要监督和安全限制。",
        ],
    },
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


def select_glossary_terms(items: list[dict]) -> list[dict]:
    text = " ".join(f"{item.get('title', '')} {item.get('summary', '')}" for item in items).lower()
    ranked = []
    for index, entry in enumerate(GLOSSARY_TERMS):
        score = 0
        for alias in entry["aliases"]:
            if alias.lower() in text:
                score += 1
        ranked.append((score, -index, entry))
    ranked.sort(reverse=True)
    selected = [entry for score, _, entry in ranked if score > 0][:3]
    for entry in GLOSSARY_TERMS:
        if len(selected) >= 3:
            break
        if entry not in selected:
            selected.append(entry)
    return selected[:3]


def glossary_lines(items: list[dict]) -> list[str]:
    lines = ["", "每日名词："]
    for index, entry in enumerate(select_glossary_terms(items), 1):
        lines.extend(["", f"{index}. {entry['term']}"])
        lines.extend(entry["body"])
    return lines


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
    lines.extend(glossary_lines(items))
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
