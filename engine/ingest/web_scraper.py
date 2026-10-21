"""Validates public URLs and retrieves bounded webpage content for research evidence.

"""

import time
import re
import socket
import ipaddress
import requests
from typing import Dict, Any, Optional, Callable
from urllib.parse import urljoin, urlparse
import trafilatura

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
        if parsed.username or parsed.password:
            return False
        if parsed.port and parsed.port not in (80, 443):
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

def scrape_webpage(
    url: str,
    timeout: int = 8,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    """
    Fetches only validated public URLs, follows at most four independently
    validated redirects, and caps response size. Search snippets remain the
    fallback when a source cannot be fetched safely.
    """
    domain = urlparse(url).netloc.replace("www.", "")
    t0 = time.time()
    deadline = time.monotonic() + max(1, timeout)

    def cancelled_result(method: str) -> Dict[str, Any]:
        """Return an empty retrieval result when cancellation/deadline interrupts a fetch."""
        return {
            "url": url,
            "domain": domain,
            "title": f"Source {domain}",
            "text": "",
            "method": method,
            "latency": round(time.time() - t0, 2),
            "char_count": 0,
        }

    if cancel_check and cancel_check():
        return cancelled_result("cancelled")

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
    
    # ── Bounded direct fetch with redirect validation ──
    try:
        current_url = url
        response = None
        for _ in range(5):
            remaining = deadline - time.monotonic()
            if (cancel_check and cancel_check()) or remaining <= 0:
                if response is not None:
                    response.close()
                return cancelled_result("cancelled" if cancel_check and cancel_check() else "timeout")
            if not is_safe_public_url(current_url):
                return {"url": url, "domain": domain, "title": f"Blocked redirect from {domain}", "text": "", "method": "blocked_redirect", "latency": round(time.time() - t0, 2), "char_count": 0}
            response = requests.get(
                current_url,
                headers=DEFAULT_HEADERS,
                timeout=(min(2.0, remaining), min(3.0, remaining)),
                allow_redirects=False,
                stream=True,
            )
            if response.is_redirect:
                location = response.headers.get("Location")
                response.close()
                if not location:
                    response = None
                    break
                current_url = urljoin(current_url, location)
                continue
            break
        if response is not None and response.status_code == 200:
            content = bytearray()
            for chunk in response.iter_content(chunk_size=65536):
                if (cancel_check and cancel_check()) or time.monotonic() >= deadline:
                    response.close()
                    return cancelled_result("cancelled" if cancel_check and cancel_check() else "timeout")
                content.extend(chunk)
                if len(content) > 5 * 1024 * 1024:
                    break
            response.close()
            if len(content) <= 5 * 1024 * 1024:
                downloaded = bytes(content)
            else:
                downloaded = None
        else:
            if response is not None:
                response.close()
            downloaded = None
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

    # Return empty so the worker can use the provider's search snippet.
    return {
        "url": url,
        "domain": domain,
        "title": f"Source {domain}",
        "text": "",
        "method": "failed",
        "latency": round(time.time() - t0, 2),
        "char_count": 0
    }
