import time
import re
import socket
import ipaddress
import requests
from typing import Dict, Any, Optional
from urllib.parse import urlparse
import trafilatura
from engine.config import JINA_READER_PREFIX

# Standard desktop User-Agent
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

def is_safe_public_url(url: str) -> bool:
    """
    SSRF Guard (CWE-918):
    Ensures the target URL uses http/https and does not resolve to loopback,
    private network (RFC1918), link-local, or cloud metadata (169.254.169.254) IPs.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        if hostname.lower() in ("localhost", "127.0.0.1", "::1", "0.0.0.0", "169.254.169.254"):
            return False

        addr_info = socket.getaddrinfo(hostname, None)
        for item in addr_info:
            ip_str = item[4][0]
            ip_obj = ipaddress.ip_address(ip_str)
            if (
                ip_obj.is_private
                or ip_obj.is_loopback
                or ip_obj.is_link_local
                or ip_obj.is_multicast
                or ip_obj.is_reserved
                or ip_obj.is_unspecified
            ):
                return False
        return True
    except Exception:
        return False

def clean_markdown_content(raw_text: str) -> str:
    """Removes excessive newlines and tracking artifacts from scraped content."""
    if not raw_text:
        return ""
    cleaned = re.sub(r'!\[.*?\]\(.*?\)', '', raw_text)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()

def scrape_webpage(url: str, timeout: int = 12) -> Dict[str, Any]:
    """
    3-Tier Resilient Scraper with SSRF Protection:
    Tier 1: Trafilatura (Ultra-fast, ~1s for open blogs/wikis)
    Tier 2: Jina Reader API (Headless browser rendering, bypasses Cloudflare/anti-bot on news sites)
    Tier 3: Graceful degradation flag if blocked
    """
    domain = urlparse(url).netloc.replace("www.", "")
    t0 = time.time()

    if not is_safe_public_url(url):
        print(f"[scraper] Blocked unsafe/non-public URL: {url}")
        return {
            "url": url,
            "domain": domain,
            "title": f"Blocked URL {domain}",
            "text": "",
            "method": "blocked_ssrf_guard",
            "latency": 0.0,
            "char_count": 0
        }
    
    # ── Tier 1: Trafilatura Direct Extraction ──
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            extracted = trafilatura.extract(
                downloaded,
                include_comments=False,
                include_tables=True,
                no_fallback=False
            )
            if extracted and len(extracted.strip()) >= 300:
                meta = trafilatura.extract_metadata(downloaded)
                title = meta.title if meta and meta.title else f"Article from {domain}"
                return {
                    "url": url,
                    "domain": domain,
                    "title": title,
                    "text": clean_markdown_content(extracted),
                    "method": "trafilatura_direct",
                    "latency": round(time.time() - t0, 2),
                    "char_count": len(extracted)
                }
    except Exception as e:
        print(f"[scraper] Tier 1 Trafilatura bypassed for {url}: {e}")

    # ── Tier 2: Jina Reader API Fallback ──
    try:
        jina_url = f"{JINA_READER_PREFIX}{url}"
        resp = requests.get(jina_url, headers=DEFAULT_HEADERS, timeout=timeout)
        if resp.status_code == 200 and len(resp.text.strip()) >= 150:
            lines = resp.text.split("\n")
            title = f"Document from {domain}"
            for line in lines[:5]:
                if line.startswith("# "):
                    title = line.replace("# ", "").strip()
                    break

            cleaned = clean_markdown_content(resp.text)
            return {
                "url": url,
                "domain": domain,
                "title": title,
                "text": cleaned,
                "method": "jina_reader_cloud",
                "latency": round(time.time() - t0, 2),
                "char_count": len(cleaned)
            }
    except Exception as e:
        print(f"[scraper] Tier 2 Jina Reader failed for {url}: {e}")

    # ── Tier 3: Return Empty (signals worker to use search snippet) ──
    return {
        "url": url,
        "domain": domain,
        "title": f"Source {domain}",
        "text": "",
        "method": "failed",
        "latency": round(time.time() - t0, 2),
        "char_count": 0
    }
