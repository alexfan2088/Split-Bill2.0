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
GLOSSARY_STATE_PATH = DATA_DIR / "glossary_state.json"
ITEM_LIMIT = 5
RECIPIENTS = [
    "1394628250@qq.com",
    "1347191150@qq.com",
    "376622979@qq.com",
    "hruicn@gmail.com",
    "rocket.tang@163.com",
]
TEST_RECIPIENTS = ["1394628250@qq.com"]
SUBJECT = "AI 每天观察"

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
    {
        "term": "多模态模型",
        "aliases": ["multimodal", "vision-language", "omni", "语音", "视频", "图像", "多模态"],
        "body": [
            "多模态模型是能同时处理文字、图片、语音、视频等多种信息的 AI 模型。",
            "它和只看文字的模型不同，可以看图理解内容、听语音判断语气、读视频里的动作，再用文字或语音回答。",
            "典型应用包括拍照问答、视频理解、实时语音助手、会议分析、工业质检和机器人视觉控制。",
            "生活类比：普通文本模型像只会读文件的人，多模态模型像既能看现场、听声音、读材料，又能综合判断的助手。",
        ],
    },
    {
        "term": "推理模型",
        "aliases": ["reasoning model", "reasoning", "推理", "思考", "o3", "o4", "deep research"],
        "body": [
            "推理模型是更擅长分步骤思考、数学、代码、规划和复杂问题分析的大模型。",
            "它通常不会只追求最快回答，而是会花更多计算量拆解问题、检查中间步骤，再给出结果。",
            "这类模型适合做复杂文档分析、代码调试、策略推演、科研辅助、数据解释和多步骤 Agent 任务。",
            "生活类比：普通模型像反应很快的问答助手，推理模型像愿意拿草稿纸认真演算的分析师。",
        ],
    },
    {
        "term": "RAG",
        "aliases": ["rag", "retrieval augmented generation", "检索增强", "知识库"],
        "body": [
            "RAG 是 Retrieval-Augmented Generation 的缩写，常译为检索增强生成。",
            "它的做法是先从企业文档、知识库或网页里检索相关资料，再让大模型基于这些资料回答问题。",
            "RAG 的价值在于降低幻觉、接入私有知识、让答案可追溯来源，也方便企业在不重新训练模型的情况下更新知识。",
            "生活类比：不用 RAG 像让人凭记忆回答；用 RAG 像先把资料翻到相关页，再让人根据资料作答。",
        ],
    },
    {
        "term": "AI 芯片",
        "aliases": ["gpu", "chip", "semiconductor", "nvidia", "inference", "算力", "芯片"],
        "body": [
            "AI 芯片是专门用来训练或运行 AI 模型的计算硬件，GPU 是其中最重要的一类。",
            "大模型需要大量矩阵计算，普通 CPU 不够高效，GPU、TPU、NPU 等芯片能更快完成训练和推理。",
            "AI 芯片影响模型成本、响应速度、数据中心建设、云服务价格，也会影响公司能不能大规模提供 AI 产品。",
            "生活类比：模型像厨师，数据像食材，AI 芯片就是厨房设备；设备越强，出餐越快，但电费和投入也更高。",
        ],
    },
    {
        "term": "合成数据",
        "aliases": ["synthetic data", "data generation", "training data", "数据", "合成数据"],
        "body": [
            "合成数据是由程序、仿真系统或 AI 模型生成的数据，用来补充真实数据不足。",
            "在 AI 训练里，真实数据可能昂贵、敏感、稀缺或有版权风险，合成数据可以覆盖更多场景和边界情况。",
            "它常用于自动驾驶、机器人、医学影像、代码训练、客服对话和安全测试等领域。",
            "生活类比：真实数据像真实考试题，合成数据像老师按知识点编的新练习题；有用，但质量必须严格检查。",
        ],
    },
    {
        "term": "模型蒸馏",
        "aliases": ["distillation", "distill", "small model", "模型蒸馏", "小模型"],
        "body": [
            "模型蒸馏是把大模型的能力压缩到更小模型里的训练方法。",
            "大模型通常能力强但成本高、速度慢；蒸馏后的模型更轻、更便宜，更适合在手机、电脑、浏览器或企业私有环境里运行。",
            "它常用于客服、搜索、代码补全、端侧 AI 和高频低成本推理场景。",
            "生活类比：大模型像资深老师，小模型像学生；蒸馏就是让学生学习老师的解题方法，尽量用更低成本完成类似任务。",
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


def has_chinese(value: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", value))


def decode_html(content: bytes) -> str:
    for encoding in ["utf-8", "gb18030", "latin-1"]:
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def extract_meta_description(page: str) -> str:
    for pattern in [
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
    ]:
        match = re.search(pattern, page, flags=re.I | re.S)
        if match:
            return clean_text(match.group(1))
    return ""


def extract_article_text(url: str, fallback: str) -> str:
    try:
        page = decode_html(fetch_url(url, timeout=15))
    except Exception as exc:
        log(f"Article fetch failed: {url}: {exc}")
        return fallback
    page = re.sub(r"(?is)<(script|style|noscript|svg|header|footer|nav|aside)[^>]*>.*?</\1>", " ", page)
    paragraphs = []
    for paragraph in re.findall(r"(?is)<p[^>]*>(.*?)</p>", page):
        text = clean_text(paragraph)
        if len(text) < 60:
            continue
        if any(skip in text.lower() for skip in ["cookie", "subscribe", "newsletter", "advertisement", "sign up"]):
            continue
        paragraphs.append(text)
        if len(" ".join(paragraphs)) >= 1400:
            break
    article = " ".join(paragraphs).strip()
    if len(article) < 160:
        article = extract_meta_description(page)
    if len(article) < 80:
        article = fallback
    return re.sub(r"\s+", " ", article).strip()[:1800]


def translate_to_chinese(text: str) -> str:
    if not text or has_chinese(text):
        return text
    chunks = [text[i : i + 1200] for i in range(0, len(text), 1200)]
    translated_chunks = []
    for chunk in chunks[:2]:
        query = urllib.parse.urlencode(
            {
                "client": "gtx",
                "sl": "auto",
                "tl": "zh-CN",
                "dt": "t",
                "q": chunk,
            }
        )
        try:
            data = json.loads(fetch_url(f"https://translate.googleapis.com/translate_a/single?{query}", timeout=15).decode("utf-8"))
            translated_chunks.append("".join(part[0] for part in data[0] if part and part[0]))
        except Exception as exc:
            log(f"Translation failed: {exc}")
            translated_chunks.append(chunk)
    return re.sub(r"\s+", " ", "".join(translated_chunks)).strip()


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
    if item.get("source") == "news.google.com":
        score -= 10
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


def load_glossary_state() -> dict:
    if not GLOSSARY_STATE_PATH.exists():
        return {"recent_terms": []}
    try:
        return json.loads(GLOSSARY_STATE_PATH.read_text("utf-8"))
    except Exception:
        return {"recent_terms": []}


def save_glossary_state(terms: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    state = load_glossary_state()
    today = dt.datetime.now().strftime("%Y-%m-%d")
    recent = list(dict.fromkeys(state.get("recent_terms", []) + [entry["term"] for entry in terms]))[-20:]
    GLOSSARY_STATE_PATH.write_text(
        json.dumps({"date": today, "recent_terms": recent, "last_terms": [entry["term"] for entry in terms]}, ensure_ascii=False, indent=2),
        "utf-8",
    )


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
    selected = fresh[:ITEM_LIMIT]
    if len(selected) < ITEM_LIMIT:
        for item in items:
            if item not in selected:
                selected.append(item)
            if len(selected) == ITEM_LIMIT:
                break
    ensure_robotics(items, selected)
    ensure_china_ai(items, selected)
    return selected[:ITEM_LIMIT]


def stars(item: dict, index: int) -> str:
    if index < 4 or item.get("score", 0) >= 18:
        return "★★★★★"
    if index < 8 or item.get("score", 0) >= 12:
        return "★★★★☆"
    return "★★★☆☆"


def infer_topic(item: dict) -> tuple[str, str, str, str]:
    text = f"{item.get('title', '')} {item.get('summary', '')}".lower()
    if any(k in text for k in ["robot", "robotics", "humanoid", "figure", "optimus", "unitree", "embodied"]):
        return (
            "机器人与具身智能",
            "大模型能力正在从屏幕里的文字、图片和代码，延伸到真实世界里的感知、移动和操作。",
            "这类消息短期看的是样机、演示和融资，长期看的是制造、仓储、零售、家庭服务和工业巡检是否会被重新组织。",
            "后续要重点看真实场景的连续运行时长、失败率、安全边界、硬件成本、维修体系，以及它能否从单次演示进入可复制交付。",
        )
    if any(k in text for k in ["chip", "gpu", "nvidia", "semiconductor", "inference", "compute", "data center", "datacenter"]):
        return (
            "算力与基础设施",
            "AI 竞争不只发生在模型参数和产品界面上，也发生在芯片、推理成本、数据中心、电力和网络能力上。",
            "谁能更稳定、更便宜地提供算力，谁就更容易支撑大规模用户、企业客户和多步骤 Agent 工作流。",
            "后续要重点看供给是否紧张、单位推理成本是否下降、客户是否愿意签长期合约，以及基础设施扩张会不会受到能源和资本开支约束。",
        )
    if any(k in text for k in ["agent", "agents", "workflow", "automation", "developer", "coding", "tool"]):
        return (
            "Agent 与开发者工具",
            "AI 正在从聊天问答变成可以拆解任务、调用工具、读取资料、写代码和执行流程的工作系统。",
            "这类进展会影响企业内部流程、软件开发方式、客服运营、数据分析和知识管理，因为它把模型能力接入了真实工作链条。",
            "后续要重点看权限控制、审计日志、错误回滚、工具调用稳定性、上下文管理，以及企业是否愿意把关键流程交给 AI 执行。",
        )
    if any(k in text for k in ["qwen", "alibaba", "doubao", "bytedance", "tencent", "yuanbao", "zhipu", "glm", "deepseek", "kimi", "china"]):
        return (
            "中国 AI 产品与模型生态",
            "中国 AI 公司的竞争正在从单纯发布模型，转向云服务、消费入口、办公协同、Agent 平台和行业解决方案的综合比拼。",
            "这类消息值得跟踪，因为国内市场既有庞大的用户规模，也有价格战、场景落地、合规要求和出海能力等多重变量。",
            "后续要重点看日活和留存是否真实提升、企业客户是否持续付费、模型成本是否可控，以及产品能否形成清晰入口而不是短期尝鲜。",
        )
    if any(k in text for k in ["openai", "anthropic", "claude", "google", "gemini", "deepmind", "xai", "grok", "model"]):
        return (
            "前沿模型与平台竞争",
            "头部模型公司的竞争已经不只是分数排名，而是模型能力、推理成本、产品入口、生态合作和企业交付的整体竞争。",
            "这类消息通常会影响开发者选型、企业采购、应用创业方向和普通用户的默认工具选择。",
            "后续要重点看新能力是否稳定开放、价格是否足够低、API 和客户端体验是否统一，以及竞争对手是否很快跟进。",
        )
    if any(k in text for k in ["funding", "raise", "valuation", "acquisition", "startup", "investment"]):
        return (
            "资本与商业化",
            "AI 投融资消息背后看的不是单笔金额，而是资本市场正在把钱押注在哪些能力、哪些团队和哪些落地场景上。",
            "如果融资能转化为算力、人才、渠道和客户交付能力，它会改变细分赛道的竞争速度；如果只停留在概念层面，估值压力也会很快反过来考验公司。",
            "后续要重点看收入质量、客户集中度、毛利率、续约率、现金消耗速度，以及融资后是否能拿出可验证的产品和商业进展。",
        )
    return (
        "AI 行业趋势",
        "这条消息反映了 AI 行业继续从技术展示走向产品化、商业化和基础设施化。",
        "判断它的重要性，不能只看标题是否吸引眼球，还要看它是否改变用户习惯、开发者工作流、企业采购逻辑或产业链资源分配。",
        "后续要重点看公开信息是否得到更多来源验证、产品是否真正可用、客户是否愿意持续付费，以及相关公司是否能把短期关注转化为长期能力。",
    )


def article_detail(item: dict) -> str:
    title = item.get("title", "")
    fallback = clean_text(f"{title}. {item.get('summary', '')}")
    original_text = extract_article_text(item.get("url", ""), fallback)
    if "comprehensive up-to-date news coverage" in original_text.lower() or "由 google 新闻" in original_text.lower():
        original_text = fallback
    translated_text = translate_to_chinese(original_text)
    if has_chinese(original_text):
        return f"原文内容：{translated_text}"
    return f"原文直译：{translated_text}"


def chinese_summary(item: dict, index: int) -> str:
    source = item.get("source", "公开来源")
    topic, context, impact, watch = infer_topic(item)
    rank_note = [
        "它排在今天前列，说明这不是一条孤立新闻，而是和近期 AI 行业的主线变化有关。",
        "它的价值在于提供了一个观察窗口，可以用来判断相关公司和赛道是否正在形成真实动能。",
        "它未必马上改变市场格局，但能帮助我们识别接下来几周需要持续跟踪的方向。",
        "它值得放进趋势列表，是因为背后牵涉到产品、资本、技术和用户采用之间的联动。",
    ][index % 4]
    return (
        f"解读：这条消息来自 {source}，主题可以归入“{topic}”。"
        f"{context}{rank_note}"
        "看这类消息时，重点不是把它当成普通新闻浏览一遍，而是要拆成三个层面理解。第一，它说明相关公司正在把 AI 能力继续往真实产品、真实客户或真实基础设施里推进；第二，它会影响产业链上其他参与者的判断，例如开发者是否跟进新平台，企业是否调整采购计划，创业公司是否重新选择切入点；第三，它也会暴露落地难点，包括成本、稳定性、数据安全、合规、渠道和用户习惯。"
        f"{impact}"
        "对普通读者来说，最实用的看法是：如果这类进展连续多次出现，就说明行业重心正在迁移；如果只有一次发布、缺少客户案例和后续数据，就要谨慎看待。"
        f"{watch}"
        "因此，这条不是只看热闹的新闻，而是可以作为今天观察 AI 竞争方向、商业化节奏和落地难度的一条信号。"
    )


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

    state = load_glossary_state()
    today = dt.datetime.now().strftime("%Y-%m-%d")
    recent_terms = set(state.get("recent_terms", []))
    if state.get("date") == today:
        recent_terms -= set(state.get("last_terms", []))

    selected: list[dict] = []
    matched = [entry for score, _, entry in ranked if score > 0]
    fresh_matched = [entry for entry in matched if entry["term"] not in recent_terms]
    hot_fresh = [entry for entry in GLOSSARY_TERMS if entry["term"] not in recent_terms and entry not in fresh_matched]

    for entry in fresh_matched + hot_fresh:
        if len(selected) >= 2:
            break
        if entry not in selected:
            selected.append(entry)

    for entry in matched + GLOSSARY_TERMS:
        if len(selected) >= 5:
            break
        if entry not in selected:
            selected.append(entry)

    for entry in GLOSSARY_TERMS:
        if len(selected) >= 5:
            break
        if entry not in selected:
            selected.append(entry)
    return selected[:5]


def glossary_lines(items: list[dict]) -> list[str]:
    lines = ["", "每日名词："]
    for index, entry in enumerate(select_glossary_terms(items), 1):
        lines.extend(["", f"{index}. {entry['term']}"])
        lines.extend(entry["body"])
    return lines


BLUE_BOLD = {"color": [0, 18000, 52000], "font": "PingFang SC Semibold"}
RED_BOLD = {"color": [52000, 0, 0], "font": "PingFang SC Semibold"}
BLACK_BOLD = {"color": [0, 0, 0], "font": "PingFang SC Semibold"}


def append_segments(parts: list[str], styles: list[dict], segments: list[tuple[str, dict | None]]) -> None:
    for text, style in segments:
        if style and text:
            styles.append({"start": len("".join(parts)) + 1, "end": len("".join(parts)) + len(text), **style})
        parts.append(text)
    parts.append("\n")


def build_body_with_styles(items: list[dict], glossary_terms: list[dict] | None = None) -> tuple[str, list[dict]]:
    today = dt.datetime.now().strftime("%Y-%m-%d")
    parts: list[str] = []
    styles: list[dict] = []
    glossary_terms = glossary_terms or select_glossary_terms(items)

    append_segments(parts, styles, [("AI 每天观察", None)])
    append_segments(parts, styles, [("", None)])
    append_segments(parts, styles, [(f"本期采集窗口：最近 3 天，生成日期：{today}。", None)])

    for idx, item in enumerate(items, 1):
        append_segments(parts, styles, [("", None)])
        append_segments(parts, styles, [(f"{idx}. {item['title']}", None)])
        append_segments(parts, styles, [("推荐指数：", BLUE_BOLD), (stars(item, idx - 1), None)])
        append_segments(parts, styles, [("中文详细解读：", BLUE_BOLD)])
        append_segments(parts, styles, [(article_detail(item), None)])
        append_segments(parts, styles, [("", None)])
        append_segments(parts, styles, [(chinese_summary(item, idx - 1), None)])
        append_segments(parts, styles, [("链接：", BLUE_BOLD)])
        append_segments(parts, styles, [(item["url"], None)])

    append_segments(parts, styles, [("", None)])
    append_segments(parts, styles, [("今日结论：", None)])
    append_segments(
        parts,
        styles,
        [
            (
                "AI 竞争正在从单点模型能力转向系统能力。每天真正值得盯的，不只是某个模型又刷新了哪个榜单，而是谁能把 AI 稳定地接入真实业务、真实设备和真实收入。后续如果某条新闻连续多天发酵，本邮件会优先追踪新增信息，避免重复搬运同一条旧链接。",
                None,
            )
        ],
    )

    append_segments(parts, styles, [("", None)])
    append_segments(parts, styles, [("每日名词：", RED_BOLD)])
    for index, entry in enumerate(glossary_terms, 1):
        append_segments(parts, styles, [("", None)])
        append_segments(parts, styles, [(f"{index}. {entry['term']}", BLACK_BOLD)])
        for line in entry["body"]:
            append_segments(parts, styles, [(line, None)])

    return "".join(parts).rstrip(), styles


def build_body(items: list[dict]) -> str:
    body, _ = build_body_with_styles(items)
    return body


def compose_gmail_url(recipient: str) -> str:
    params = {
        "view": "cm",
        "fs": "1",
        "to": recipient,
        "su": SUBJECT,
    }
    return "https://mail.google.com/mail/?" + urllib.parse.urlencode(params)


def run_osascript(script: str) -> None:
    result = subprocess.run(["osascript", "-e", script], text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())


def start_caffeinate_guard() -> subprocess.Popen | None:
    try:
        return subprocess.Popen(["/usr/bin/caffeinate", "-dimsu", "-w", str(os.getpid())])
    except Exception as exc:
        log(f"Could not start caffeinate guard: {exc}")
        return None


def applescript_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def prewarm_mail() -> None:
    script = '''
with timeout of 90 seconds
  tell application "Mail"
    activate
    delay 5
    check for new mail
  end tell
end timeout
'''
    try:
        run_osascript(script)
        log("Mail prewarm completed")
    except Exception as exc:
        log(f"Mail prewarm warning: {exc}")


def mail_style_commands(styles: list[dict] | None) -> str:
    if not styles:
        return ""
    commands = []
    for style in styles:
        start = style["start"]
        end = style["end"]
        target = f"characters {start} thru {end} of content of newMessage"
        if "color" in style:
            color = ", ".join(str(value) for value in style["color"])
            commands.append(f"      set color of {target} to {{{color}}}")
        if "font" in style:
            commands.append(f"      set font of {target} to {applescript_string(style['font'])}")
    return "\n".join(commands)


def send_one_via_mail(body_path: Path, recipient: str, styles: list[dict] | None = None, timeout: int = 180) -> None:
    escaped_path = str(body_path).replace('"', '\\"')
    style_commands = mail_style_commands(styles)
    script = f'''
set bodyText to read POSIX file "{escaped_path}" as «class utf8»
with timeout of {timeout} seconds
  tell application "Mail"
    activate
    set newMessage to make new outgoing message with properties {{subject:{applescript_string(SUBJECT)}, content:bodyText, visible:false}}
    tell newMessage
      make new to recipient at end of to recipients with properties {{address:{applescript_string(recipient)}}}
{style_commands}
      send
    end tell
  end tell
end timeout
'''
    run_osascript(script)


def send_via_mail(body_path: Path, recipients: list[str], styles: list[dict] | None = None) -> None:
    failures = []
    prewarm_mail()
    use_rich_text = bool(styles)
    for recipient in recipients:
        log(f"Sending Mail message to {recipient}")
        try:
            send_one_via_mail(body_path, recipient, styles if use_rich_text else None, timeout=120)
        except Exception as exc:
            if use_rich_text:
                log(f"Rich text Mail send failed for {recipient}; falling back to plain text: {exc}")
                use_rich_text = False
                prewarm_mail()
                try:
                    send_one_via_mail(body_path, recipient, None, timeout=120)
                    log(f"Plain text fallback succeeded for {recipient}")
                    continue
                except Exception as fallback_exc:
                    failures.append(f"{recipient}: rich text failed: {exc}; plain text failed: {fallback_exc}")
                    log(f"Mail send failed for {recipient}: {fallback_exc}")
            else:
                failures.append(f"{recipient}: {exc}")
                log(f"Mail send failed for {recipient}: {exc}")
    if failures:
        raise RuntimeError("Some Mail sends failed: " + " | ".join(failures))


def send_one_via_gmail(body_path: Path, recipient: str) -> None:
    url = compose_gmail_url(recipient)
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
with timeout of 300 seconds
  tell application "System Events"
    set frontmost of process "Google Chrome" to true
    delay 1
    keystroke "v" using {{command down}}
    delay 2
    key code 36 using {{command down}}
  end tell
end timeout
delay 5
'''
    run_osascript(script)


def send_via_gmail(body_path: Path, recipients: list[str]) -> None:
    failures = []
    for recipient in recipients:
        log(f"Sending Gmail web message to {recipient}")
        try:
            send_one_via_gmail(body_path, recipient)
        except Exception as exc:
            failures.append(f"{recipient}: {exc}")
            log(f"Gmail web send failed for {recipient}: {exc}")
    if failures:
        raise RuntimeError("Some Gmail web sends failed: " + " | ".join(failures))


def write_body(body: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"ai_daily_{dt.datetime.now().strftime('%Y-%m-%d')}.txt"
    path.write_text(body, "utf-8")
    return path


def main() -> int:
    caffeinate_guard = start_caffeinate_guard()
    parser = argparse.ArgumentParser()
    parser.add_argument("--send", action="store_true", help="Send the generated email through Gmail web UI.")
    parser.add_argument("--mail", action="store_true", help="Send through macOS Mail instead of Gmail web UI.")
    parser.add_argument("--test", action="store_true", help="Send only to the configured test recipient.")
    parser.add_argument("--dry-run", action="store_true", help="Generate only and print the output path.")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log("Collecting AI news")
    items = collect_items()
    if len(items) < ITEM_LIMIT:
        log(f"Only collected {len(items)} eligible items; continuing with available items")
    selected = select_items(items)
    if not selected:
        raise RuntimeError("No AI news items collected.")

    glossary_terms = select_glossary_terms(selected)
    body, styles = build_body_with_styles(selected, glossary_terms)
    body_path = write_body(body)
    log(f"Wrote {body_path}")

    if args.send:
        recipients = TEST_RECIPIENTS if args.test else RECIPIENTS
        if args.mail:
            log(f"Sending through macOS Mail to {', '.join(recipients)}")
            send_via_mail(body_path, recipients, styles)
        else:
            log(f"Sending through Gmail web to {', '.join(recipients)}")
            send_via_gmail(body_path, recipients)
        if args.test:
            log("Test send completed; sent URL state was not updated")
        else:
            state = load_state()
            state["sent_urls"] = list(dict.fromkeys(state.get("sent_urls", []) + [i["url"] for i in selected]))
            save_state(state)
            save_glossary_state(glossary_terms)
        log("Send command completed")
    elif args.dry_run:
        print(body_path)
    if caffeinate_guard:
        caffeinate_guard.poll()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"ERROR: {exc}")
        raise
