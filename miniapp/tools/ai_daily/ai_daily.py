#!/usr/bin/env python3
"""Build and send the daily AI news email via the logged-in Gmail web UI."""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import html
import io
import json
import os
import re
import smtplib
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.message import EmailMessage
from pathlib import Path

try:
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import Image as PdfImage
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    from PIL import Image as PilImage
except ImportError as exc:
    raise RuntimeError(
        "缺少 PDF 依赖 reportlab。请运行：python3 -m pip install -r tools/ai_daily/requirements.txt"
    ) from exc


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path.home() / ".codex" / "ai_daily"
OUT_DIR = DATA_DIR / "out"
PDF_OUT_DIR = OUT_DIR / "pdf"
STATE_PATH = DATA_DIR / "sent_urls.json"
GLOSSARY_STATE_PATH = DATA_DIR / "glossary_state.json"
SMTP_CONFIG_PATH = DATA_DIR / "smtp.json"
ITEM_LIMIT = 3
MAX_IMAGES_PER_ARTICLE = 3
RECIPIENTS = [
    "hruicn@gmail.com",
    "rocket.tang@163.com",
    "alexfan2088@gmail.com",
]
TEST_RECIPIENTS = ["alexfan2088@gmail.com"]
SUBJECT = "AI 每天观察"
SMTP_KEYCHAIN_SERVICE = "ai-daily-smtp-password"
GOOGLE_TRANSLATE_API_RATE_LIMITED = False

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


def extract_article_text(url: str, fallback: str) -> dict:
    try:
        page = decode_html(fetch_url(url, timeout=15))
    except Exception as exc:
        log(f"Article fetch failed: {url}: {exc}")
        return {"text": fallback, "kind": "summary", "images": [], "blocks": [{"type": "text", "text": fallback}]}
    page = re.sub(r"(?is)<(script|style|noscript|svg|header|footer|nav|aside)[^>]*>.*?</\1>", " ", page)
    blocks = extract_article_blocks(page, url)
    paragraphs = [block["text"] for block in blocks if block["type"] == "text"]
    image_urls = [block["url"] for block in blocks if block["type"] == "image"]
    if not image_urls:
        image_urls = extract_article_images(page, url)
    article = " ".join(paragraphs).strip()
    if len(article) >= 300:
        return {"text": re.sub(r"\s+", " ", article).strip(), "kind": "article", "images": image_urls, "blocks": blocks}
    description = extract_meta_description(page)
    if len(description) >= 80:
        return {"text": description, "kind": "summary", "images": image_urls, "blocks": [{"type": "text", "text": description}]}
    return {"text": fallback, "kind": "summary", "images": image_urls, "blocks": [{"type": "text", "text": fallback}]}


def extract_image_url(fragment: str, article_url: str) -> str:
    match = re.search(r"<img[^>]+(?:src|data-src)=[\"']([^\"']+)", fragment, flags=re.I | re.S)
    if not match:
        return ""
    image_url = urllib.parse.urljoin(article_url, html.unescape(match.group(1)).strip())
    lower = image_url.lower()
    if not image_url.startswith("https://") or lower.startswith("data:"):
        return ""
    if any(part in lower for part in ["logo", "icon", "avatar", "advert", "tracking", "pixel", "-268x", "thumbnail"]):
        return ""
    return image_url


def extract_article_blocks(page: str, article_url: str) -> list[dict]:
    """Return readable text and figure blocks in source order for the translated PDF."""
    blocks: list[dict] = []
    seen_images: set[str] = set()
    # 同时匹配独立图片标签：许多 WordPress 文章把 img 直接放在正文流中。
    pattern = r"(?is)<p\b[^>]*>.*?</p>|<figure\b[^>]*>.*?</figure>|<img\b[^>]*>"
    for match in re.finditer(pattern, page):
        fragment = match.group(0)
        tag_match = re.match(r"(?is)<(p|figure|img)\b", fragment)
        if not tag_match:
            continue
        tag = tag_match.group(1).lower()
        if tag == "img":
            image_url = extract_image_url(fragment, article_url)
            if image_url and image_url not in seen_images and len(seen_images) < MAX_IMAGES_PER_ARTICLE:
                blocks.append({"type": "image", "url": image_url, "caption": ""})
                seen_images.add(image_url)
            continue
        if tag == "figure":
            image_url = extract_image_url(fragment, article_url)
            if image_url and image_url not in seen_images and len(seen_images) < MAX_IMAGES_PER_ARTICLE:
                caption_match = re.search(r"(?is)<figcaption[^>]*>(.*?)</figcaption>", fragment)
                caption = clean_text(caption_match.group(1)) if caption_match else ""
                blocks.append({"type": "image", "url": image_url, "caption": caption})
                seen_images.add(image_url)
            continue
        text = clean_text(fragment)
        if len(text) < 60:
            text = ""
        if text and not any(skip in text.lower() for skip in ["cookie", "subscribe", "newsletter", "advertisement", "sign up"]):
            blocks.append({"type": "text", "text": text})
        # WordPress 等站点常把正文图直接放进 p 标签，而不使用 figure。
        # 此处紧跟该段落写入图片，避免所有图在文末集中堆积。
        image_url = extract_image_url(fragment, article_url)
        if image_url and image_url not in seen_images and len(seen_images) < MAX_IMAGES_PER_ARTICLE:
            blocks.append({"type": "image", "url": image_url, "caption": ""})
            seen_images.add(image_url)
    return blocks


def extract_article_images(page: str, article_url: str) -> list[str]:
    candidates: list[str] = []
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image',
        r'<img[^>]+(?:src|data-src)=["\']([^"\']+)',
    ]
    for pattern in patterns:
        for value in re.findall(pattern, page, flags=re.I | re.S):
            image_url = urllib.parse.urljoin(article_url, html.unescape(value).strip())
            lower = image_url.lower()
            if not image_url.startswith("https://") or lower.startswith("data:"):
                continue
            if any(part in lower for part in ["logo", "icon", "avatar", "advert", "tracking", "pixel", "-268x", "thumbnail"]):
                continue
            if image_url not in candidates:
                candidates.append(image_url)
            if len(candidates) >= MAX_IMAGES_PER_ARTICLE:
                return candidates
    return candidates


def translate_to_chinese(text: str) -> str:
    global GOOGLE_TRANSLATE_API_RATE_LIMITED
    if not text or has_chinese(text):
        return text
    # 按句子分段，避免硬切英文单词；每段较短也能降低公共翻译接口超时概率。
    chunks: list[str] = []
    current = ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if len(current) + len(sentence) + 1 > 450 and current:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    translated_chunks = []
    for chunk in chunks:
        google_query = urllib.parse.urlencode(
            {
                "client": "gtx",
                "sl": "auto",
                "tl": "zh-CN",
                "dt": "t",
                "q": chunk,
            }
        )
        memory_query = urllib.parse.urlencode({"q": chunk, "langpair": "en|zh-CN"})
        translated = ""
        last_error: Exception | None = None
        # 主服务使用 Google；域名切换可避开偶发限流。
        for host in (() if GOOGLE_TRANSLATE_API_RATE_LIMITED else ("translate.googleapis.com", "translate.google.com")):
            try:
                data = json.loads(fetch_url(f"https://{host}/translate_a/single?{google_query}", timeout=8).decode("utf-8"))
                candidate = "".join(part[0] for part in data[0] if part and part[0]).strip()
                if candidate and has_chinese(candidate):
                    translated = candidate
                    break
                raise RuntimeError("translation response contains no Chinese text")
            except Exception as exc:
                last_error = exc
                if getattr(exc, "code", None) == 429:
                    GOOGLE_TRANSLATE_API_RATE_LIMITED = True
                    break
            if translated:
                break
        if not translated:
            try:
                candidate = translate_via_google_web(chunk)
                if candidate and has_chinese(candidate):
                    translated = candidate
                else:
                    raise RuntimeError("Google web translation response contains no Chinese text")
            except Exception as exc:
                last_error = exc
        # 独立的 MyMemory 翻译服务作为第二供应商，避免单一服务异常导致日报无法产出。
        if not translated:
            try:
                data = json.loads(fetch_url(f"https://api.mymemory.translated.net/get?{memory_query}", timeout=20).decode("utf-8"))
                candidate = clean_text((data.get("responseData") or {}).get("translatedText", ""))
                if candidate and has_chinese(candidate):
                    translated = candidate
                else:
                    raise RuntimeError("MyMemory response contains no Chinese text")
            except Exception as exc:
                last_error = exc
        if not translated:
            raise RuntimeError(
                f"英文内容未能翻译成中文，已终止本期日报生成，避免发送非中文内容：{last_error}"
            )
        translated_chunks.append(translated)
    return re.sub(r"\s+", " ", "".join(translated_chunks)).strip()


def translate_via_google_web(text: str) -> str:
    """Use Google Translate's mobile web page when the API endpoint is rate-limited."""
    query = urllib.parse.urlencode({"sl": "auto", "tl": "zh-CN", "q": text})
    page = fetch_url(f"https://translate.google.com/m?{query}", timeout=20).decode("utf-8")
    match = re.search(r'<div[^>]*class="result-container"[^>]*>(.*?)</div>', page, flags=re.S)
    if not match:
        raise RuntimeError("Google web translation result was not found")
    return clean_text(html.unescape(match.group(1)))


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


def get_article_extraction(item: dict) -> dict:
    if "_article_extraction" in item:
        return item["_article_extraction"]
    title = item.get("title", "")
    summary = clean_text(item.get("summary", ""))
    fallback = summary or title
    extraction = extract_article_text(item.get("url", ""), fallback)
    original_text = extraction["text"]
    if "comprehensive up-to-date news coverage" in original_text.lower() or "由 google 新闻" in original_text.lower():
        extraction = {
            "text": fallback,
            "kind": "summary",
            "images": extraction.get("images", []),
            "blocks": [{"type": "text", "text": fallback}],
        }
    item["_article_extraction"] = extraction
    return extraction


def prefer_full_article_items(selected: list[dict], candidates: list[dict]) -> list[dict]:
    full_articles: list[dict] = []
    seen: set[str] = set()
    for item in selected + candidates:
        url = item.get("url", "")
        if not url or url in seen:
            continue
        seen.add(url)
        try:
            extraction = get_article_extraction(item)
        except Exception as exc:
            log(f"Article extraction failed while selecting: {url}: {exc}")
            continue
        if extraction.get("kind") == "article":
            full_articles.append(item)
            if len(full_articles) == ITEM_LIMIT:
                return full_articles

    for item in selected:
        if item not in full_articles:
            full_articles.append(item)
        if len(full_articles) == ITEM_LIMIT:
            break
    return full_articles[:ITEM_LIMIT]


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
    extraction = get_article_extraction(item)
    original_text = extraction["text"]
    translated_text = get_translated_extraction(item)
    if not translated_text and not has_chinese(original_text):
        return "原文中文翻译暂不可用；本期不展示英文原文，避免将英文误标为中文译文。"
    if extraction["kind"] == "article":
        if has_chinese(original_text):
            return f"原文内容：{translated_text}"
        return f"原文正文中文直译（共 {len(original_text)} 字符）：{translated_text}"
    if has_chinese(original_text):
        return f"来源摘要内容：{translated_text}"
    return f"来源摘要直译：{translated_text}"


def get_translated_extraction(item: dict) -> str:
    if "_translated_extraction" not in item:
        extraction = get_article_extraction(item)
        translated_blocks = get_translated_blocks(item)
        text = " ".join(block["text"] for block in translated_blocks if block["type"] == "text")
        item["_translated_extraction"] = text or translate_to_chinese(extraction["text"])
    return item["_translated_extraction"]


def get_translated_blocks(item: dict) -> list[dict]:
    if "_translated_blocks" in item:
        return item["_translated_blocks"]
    translated: list[dict] = []
    for block in get_article_extraction(item).get("blocks", []):
        if block["type"] == "text":
            translated.append({"type": "text", "text": translate_to_chinese(block["text"])})
        else:
            translated.append(block.copy())
    item["_translated_blocks"] = translated
    return translated


def get_translated_title(item: dict) -> str:
    if "_translated_title" not in item:
        title = clean_text(item.get("title", ""))
        item["_translated_title"] = translate_to_chinese(title)
    return item["_translated_title"]


def safe_filename(value: str, limit: int = 42) -> str:
    value = re.sub(r"[^\w\-\u4e00-\u9fff]+", "_", value).strip("_")
    return (value[:limit] or "article")


def register_pdf_font() -> str:
    # ReportLab 自带的 CID 中文字体可稳定输出简体中文，且不依赖运行机器上的字体文件。
    font_name = "STSong-Light"
    if font_name in pdfmetrics.getRegisteredFontNames():
        return font_name
    pdfmetrics.registerFont(UnicodeCIDFont(font_name))
    return font_name


def build_article_pdf(item: dict, index: int, report_date: str) -> Path:
    """Create one translated-source PDF, preserving the text/figure source order."""
    font_name = register_pdf_font()
    PDF_OUT_DIR.mkdir(parents=True, exist_ok=True)
    title = get_translated_title(item)
    path = PDF_OUT_DIR / f"ai_daily_{report_date}_{index}_{safe_filename(title)}.pdf"
    document = SimpleDocTemplate(
        str(path), pagesize=A4, leftMargin=17 * mm, rightMargin=17 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    heading = ParagraphStyle("AIDailyHeading", parent=styles["Heading1"], fontName=font_name, fontSize=17, leading=24, alignment=TA_CENTER, spaceAfter=12)
    meta = ParagraphStyle("AIDailyMeta", parent=styles["BodyText"], fontName=font_name, fontSize=9, leading=14, textColor="#555555", spaceAfter=7)
    body = ParagraphStyle("AIDailyBody", parent=styles["BodyText"], fontName=font_name, fontSize=10.5, leading=19, wordWrap="CJK", spaceAfter=8)
    caption = ParagraphStyle("AIDailyCaption", parent=meta, fontSize=8.5, leading=12, alignment=TA_CENTER, spaceAfter=10)
    story = [
        Paragraph(html.escape(title), heading),
        Paragraph("中文直译原文（图片按原文出现位置排版）", meta),
        Paragraph(f'原文链接：<link href="{html.escape(item["url"])}">{html.escape(item["url"])}</link>', meta),
        Spacer(1, 5),
    ]
    for block in get_translated_blocks(item):
        if block["type"] == "text":
            story.append(Paragraph(html.escape(block["text"]), body))
            continue
        image_url = block["url"]
        try:
            image_data = fetch_url(image_url, timeout=15)
            if not image_data or len(image_data) > 12 * 1024 * 1024:
                raise RuntimeError("图片为空或超过 12 MB")
            # 先完整解码再转为 JPEG，避免 ReportLab 在最终绘制时才因 WebP、透明 PNG
            # 或损坏图片中断整个 PDF 的生成。
            source_image = PilImage.open(io.BytesIO(image_data))
            source_image.load()
            if source_image.mode in {"RGBA", "LA"}:
                background = PilImage.new("RGB", source_image.size, "white")
                background.paste(source_image.convert("RGBA"), mask=source_image.convert("RGBA").getchannel("A"))
                source_image = background
            elif source_image.mode != "RGB":
                source_image = source_image.convert("RGB")
            normalized = io.BytesIO()
            source_image.save(normalized, format="JPEG", quality=88, optimize=True)
            normalized.seek(0)
            image = PdfImage(normalized)
            image._restrictSize(document.width, 125 * mm)
            story.extend([Spacer(1, 3), image])
            if block.get("caption"):
                story.append(Paragraph(html.escape(translate_to_chinese(block["caption"])), caption))
            else:
                story.append(Spacer(1, 8))
        except Exception as exc:
            log(f"PDF image download failed: {image_url}: {exc}")
            story.append(Paragraph(f"原文图片未能下载：{html.escape(image_url)}", caption))
    document.build(story)
    return path


def build_article_pdfs(items: list[dict]) -> list[Path]:
    report_date = dt.datetime.now().strftime("%Y-%m-%d")
    paths = []
    for index, item in enumerate(items, 1):
        path = build_article_pdf(item, index, report_date)
        paths.append(path)
        log(f"Wrote translated article PDF: {path}")
    return paths


def split_sentences(text: str) -> list[str]:
    candidates = re.split(r"(?<=[。！？；.!?;])\s*", text)
    return [sentence.strip() for sentence in candidates if len(sentence.strip()) >= 18]


def compact_fact(text: str, limit: int = 130) -> str:
    sentences = split_sentences(text)
    if not sentences:
        return text[:limit].strip()
    fact = sentences[0]
    if len(fact) < 55 and len(sentences) > 1 and sentences[1] != sentences[0]:
        fact = f"{fact}{sentences[1]}"
    return fact[:limit].strip()


def named_subject(item: dict, translated_text: str) -> str:
    title_text = item.get("title", "").lower()
    body_text = translated_text.lower()
    subjects = [
        ("openai", "OpenAI"),
        ("xai", "xAI"),
        ("grok", "Grok"),
        ("anthropic", "Anthropic"),
        ("claude", "Claude"),
        ("google", "Google"),
        ("deepmind", "Google DeepMind"),
        ("gemini", "Gemini"),
        ("microsoft", "Microsoft"),
        ("nvidia", "NVIDIA"),
        ("neura", "NEURA Robotics"),
        ("notion", "Notion"),
        ("qwen", "通义千问"),
        ("alibaba", "阿里"),
        ("doubao", "豆包"),
        ("bytedance", "字节跳动"),
        ("deepseek", "DeepSeek"),
        ("robot", "机器人公司"),
        ("robots", "机器人公司"),
    ]
    matched = [label for keyword, label in subjects if keyword in title_text]
    if not matched:
        matched = [label for keyword, label in subjects if keyword in body_text]
    return "、".join(dict.fromkeys(matched[:3])) or "相关公司"


def specific_watchpoint(item: dict, translated_text: str) -> str:
    title = item.get("title", "").lower()
    text = f"{title} {translated_text}".lower()
    if any(word in title for word in ["lawsuit", "fired", "safety"]):
        return "看后续诉讼材料、内部安全流程和管理层回应，因为这会影响外界对模型公司治理能力的判断。"
    if "conscious" in title:
        return "看头部公司会不会收紧产品话术和研究表达，因为“AI 是否有意识”的叙事会影响用户预期、监管态度和品牌风险。"
    if any(word in title for word in ["local ai", "diffusiongemma", "on-device"]):
        return "看本地运行的速度、硬件门槛和真实应用质量，因为这决定它是技术演示还是能进入个人电脑和边缘设备。"
    if any(word in title for word in ["robotics", "robots", "humanoid", "physical ai"]):
        if any(word in title for word in ["funding", "raises", "raise", "series"]):
            return "看这笔钱是否能换来可交付的机器人产品、量产能力和真实客户，而不只是继续推高具身智能估值。"
        return "看真实环境里的失败率、部署成本和安全边界，因为机器人行业很难像纯软件模型那样快速复制扩张。"
    if any(word in text for word in ["outage", "disruption", "restores access", "中断", "恢复访问"]):
        return "看后续是否披露故障边界、替代方案和客户补偿，因为这直接关系到企业是否敢把核心工作流托付给单一 AI 服务。"
    if any(word in text for word in ["funding", "raises", "valuation", "融资", "估值", "投资"]):
        return "看融资后能否转化为产品交付和真实收入，而不是只停留在估值叙事。"
    if any(word in text for word in ["launch", "release", "unveil", "open", "发布", "推出", "开放", "上线"]):
        return "看这个新产品或新能力是否能进入日常使用场景，尤其是价格、易用性和稳定性是否跟得上。"
    if any(word in text for word in ["partner", "partnership", "hub", "collaboration", "合作", "中心", "hub"]):
        return "看合作或新中心能否带来可复制的客户案例，而不只是品牌展示和生态表态。"
    if any(word in text for word in ["robot", "robots", "manufacturing", "worker", "机器人", "制造", "工人"]):
        return "看它在真实工厂里的良率、节拍、安全责任和维护成本，这些比演示视频更能说明商业价值。"
    if any(word in text for word in ["chip", "gpu", "inference", "data center", "芯片", "算力", "推理", "数据中心"]):
        return "看单位推理成本和供给稳定性，因为这会直接决定 AI 产品能不能大规模便宜地提供。"
    return "看后续是否有客户、收入、使用量或技术指标的持续验证，避免只被单次发布带动情绪。"


def specific_meaning(item: dict, translated_text: str) -> str:
    title = item.get("title", "").lower()
    text = f"{title} {translated_text}".lower()
    if any(word in title for word in ["lawsuit", "fired", "safety"]):
        return "这不是普通人事纠纷，而是模型公司内部安全意见、商业压力和治理透明度之间的冲突被公开化。"
    if "conscious" in title:
        return "这篇文章的重点不是争论模型真的有没有意识，而是 AI 公司如何描述模型，会反过来塑造用户信任、监管关注和产品责任边界。"
    if any(word in title for word in ["local ai", "diffusiongemma", "on-device"]):
        return "它说明 AI 竞争正在从云端大模型能力，延伸到本地设备能否低延迟、低成本运行生成模型。"
    if any(word in title for word in ["robotics", "robots", "humanoid", "physical ai"]):
        if any(word in title for word in ["funding", "raises", "raise", "series"]):
            return "这条消息的核心是资本继续押注 physical AI，但机器人公司的难点会从演示能力转向量产、交付和售后体系。"
        return "这篇文章的重点是：人形机器人即使已经进入客户现场，收入、现金消耗和估值之间仍可能存在很大差距；商业化能否成立取决于持续部署和客户付费。"
    if any(word in text for word in ["outage", "disruption", "restores access", "中断", "恢复访问"]):
        return "它提醒企业客户，AI 工具一旦嵌入工作流，服务稳定性和供应商依赖就会变成实际运营风险。"
    if any(word in text for word in ["funding", "raises", "valuation", "融资", "估值", "投资"]):
        return "这条消息要看融资背后的商业兑现能力，尤其是客户、收入和成本结构是否支撑估值。"
    if any(word in text for word in ["launch", "release", "unveil", "发布", "推出", "上线"]):
        return "它的看点在于新能力能不能从发布稿进入真实使用，而不是只增加一个短期热点。"
    return "它的价值在于提供了一个具体观察点，用来判断 AI 能力是否正在进入真实产品、真实客户或真实基础设施。"


def chinese_summary(item: dict, index: int) -> str:
    source = item.get("source", "公开来源")
    topic, context, impact, watch = infer_topic(item)
    translated_text = get_translated_extraction(item)
    fact = compact_fact(translated_text) if translated_text else "该报道的中文全文翻译本期生成失败，已保留核心中文解读。"
    meaning = specific_meaning(item, translated_text)
    watchpoint = specific_watchpoint(item, translated_text)
    return (
        f"解读：这篇来自 {source} 的文章，具体讲的是：{fact}"
        f"放在“{topic}”里看，{meaning}"
        f"{watchpoint}"
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
        append_segments(parts, styles, [(f"{idx}. {get_translated_title(item)}", None)])
        append_segments(parts, styles, [("链接：", BLUE_BOLD)])
        append_segments(parts, styles, [(item["url"], None)])
        append_segments(parts, styles, [("推荐指数：", BLUE_BOLD), (stars(item, idx - 1), None)])
        append_segments(parts, styles, [("总结解读：", BLUE_BOLD)])
        append_segments(parts, styles, [(chinese_summary(item, idx - 1), None)])
        append_segments(parts, styles, [("", None)])
        append_segments(parts, styles, [("中文直译：", BLUE_BOLD)])
        append_segments(parts, styles, [(f"请见附件 PDF《{idx}_{safe_filename(get_translated_title(item))}》；其中图片已按原文出现位置与相关段落排版。", None)])

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


def run_osascript_lines(lines: list[str]) -> None:
    command = ["osascript"]
    for line in lines:
        command.extend(["-e", line])
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())


def read_keychain_password(service: str, account: str) -> str:
    result = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def load_smtp_config() -> dict:
    config = {
        "host": os.environ.get("AI_DAILY_SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.environ.get("AI_DAILY_SMTP_PORT", "587")),
        "user": os.environ.get("AI_DAILY_SMTP_USER", ""),
        "from": os.environ.get("AI_DAILY_SMTP_FROM", ""),
    }
    if SMTP_CONFIG_PATH.exists():
        try:
            file_config = json.loads(SMTP_CONFIG_PATH.read_text("utf-8"))
            config.update({key: value for key, value in file_config.items() if value})
        except Exception as exc:
            log(f"SMTP config warning: {exc}")
    if not config["from"]:
        config["from"] = config["user"]
    password = os.environ.get("AI_DAILY_SMTP_PASSWORD", "")
    if not password and config["user"]:
        password = read_keychain_password(SMTP_KEYCHAIN_SERVICE, config["user"])
    config["password"] = password
    return config


def smtp_is_configured() -> bool:
    config = load_smtp_config()
    return bool(config.get("host") and config.get("port") and config.get("user") and config.get("from") and config.get("password"))


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


def apple_color_to_css(color: list[int]) -> str:
    rgb = [max(0, min(255, round(value / 65535 * 255))) for value in color]
    return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"


def style_to_css(style: dict) -> str:
    declarations = []
    if "color" in style:
        declarations.append(f"color: {apple_color_to_css(style['color'])}")
    if "font" in style:
        declarations.append("font-weight: 700")
    return "; ".join(declarations)


def body_to_html(body: str, styles: list[dict] | None = None) -> str:
    styles = sorted(styles or [], key=lambda item: item["start"])
    pieces = []
    cursor = 0
    for style in styles:
        start = max(0, style["start"] - 1)
        end = min(len(body), style["end"])
        if start > cursor:
            pieces.append(html.escape(body[cursor:start]))
        if end > start:
            css = style_to_css(style)
            pieces.append(f'<span style="{css}">{html.escape(body[start:end])}</span>')
        cursor = max(cursor, end)
    if cursor < len(body):
        pieces.append(html.escape(body[cursor:]))
    content = "".join(pieces)
    return (
        '<!doctype html><html><body>'
        '<div style="font-family: -apple-system, BlinkMacSystemFont, '
        "'PingFang SC', 'Microsoft YaHei', Arial, sans-serif; "
        'font-size: 15px; line-height: 1.65; white-space: pre-wrap; color: #111;">'
        f"{content}</div></body></html>"
    )


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


def send_via_smtp(body_path: Path, recipients: list[str], styles: list[dict] | None = None, pdf_paths: list[Path] | None = None) -> None:
    config = load_smtp_config()
    missing = [key for key in ["host", "port", "user", "from", "password"] if not config.get(key)]
    if missing:
        raise RuntimeError(
            "SMTP is not configured; missing "
            + ", ".join(missing)
            + f". Create {SMTP_CONFIG_PATH} and store the password in keychain service {SMTP_KEYCHAIN_SERVICE}."
        )

    body = body_path.read_text("utf-8")
    html_body = body_to_html(body, styles)
    failures = []
    for recipient in recipients:
        log(f"Sending SMTP message to {recipient}")
        message = EmailMessage()
        message["From"] = config["from"]
        message["To"] = recipient
        message["Subject"] = SUBJECT
        message.set_content(body)
        message.add_alternative(html_body, subtype="html")
        for pdf_path in pdf_paths or []:
            message.add_attachment(pdf_path.read_bytes(), maintype="application", subtype="pdf", filename=pdf_path.name)
        try:
            with smtplib.SMTP(config["host"], int(config["port"]), timeout=60) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
                smtp.login(config["user"], config["password"])
                smtp.send_message(message)
        except Exception as exc:
            failures.append(f"{recipient}: {exc}")
            log(f"SMTP send failed for {recipient}: {exc}")
    if failures:
        raise RuntimeError("Some SMTP sends failed: " + " | ".join(failures))


def send_one_via_gmail(body_path: Path, recipient: str) -> None:
    url = compose_gmail_url(recipient)
    body_posix = str(body_path)
    run_osascript_lines(
        [
            "with timeout of 60 seconds",
            '  tell application "Google Chrome"',
            "    activate",
            f"    open location {applescript_string(url)}",
            "  end tell",
            "end timeout",
        ]
    )
    time.sleep(10)
    run_osascript_lines(
        [
            f"set bodyText to read POSIX file {applescript_string(body_posix)} as «class utf8»",
            "set the clipboard to bodyText",
            "with timeout of 90 seconds",
            '  tell application "System Events"',
            '    if not (exists process "Google Chrome") then error "Google Chrome process is not available"',
            '    set frontmost of process "Google Chrome" to true',
            "    delay 2",
            '    keystroke "v" using {command down}',
            "    delay 3",
            "    key code 36 using {command down}",
            "  end tell",
            "end timeout",
        ]
    )
    time.sleep(8)


def send_via_gmail(body_path: Path, recipients: list[str]) -> None:
    failures = []
    for recipient in recipients:
        sent = False
        last_error: Exception | None = None
        for attempt in range(1, 4):
            log(f"Sending Gmail web message to {recipient} (attempt {attempt}/3)")
            try:
                send_one_via_gmail(body_path, recipient)
                sent = True
                break
            except Exception as exc:
                last_error = exc
                log(f"Gmail web send attempt {attempt} failed for {recipient}: {exc}")
                time.sleep(15)
        if not sent:
            failures.append(f"{recipient}: {last_error}")
            log(f"Gmail web send failed for {recipient}: {last_error}")
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
    parser.add_argument("--send", action="store_true", help="Send the generated email. Defaults to SMTP when configured.")
    parser.add_argument("--smtp", action="store_true", help="Send through SMTP.")
    parser.add_argument("--gmail-web", action="store_true", help="Send through Gmail web UI.")
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
    selected = prefer_full_article_items(selected, items)
    if not selected:
        raise RuntimeError("No AI news items collected.")

    glossary_terms = select_glossary_terms(selected)
    body, styles = build_body_with_styles(selected, glossary_terms)
    body_path = write_body(body)
    log(f"Wrote {body_path}")
    pdf_paths = build_article_pdfs(selected)

    if args.send:
        recipients = TEST_RECIPIENTS if args.test else RECIPIENTS
        if args.mail:
            raise RuntimeError("PDF 附件仅支持 SMTP 发送；请移除 --mail 并配置 SMTP。")
        elif args.gmail_web:
            raise RuntimeError("PDF 附件仅支持 SMTP 发送；请移除 --gmail-web 并配置 SMTP。")
        elif args.smtp or smtp_is_configured():
            log(f"Sending through SMTP to {', '.join(recipients)}")
            send_via_smtp(body_path, recipients, styles, pdf_paths)
        else:
            raise RuntimeError("PDF 附件需要 SMTP。请配置 SMTP 后使用 --send --smtp。")
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
