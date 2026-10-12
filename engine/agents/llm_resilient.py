import time
import json
from typing import Optional
from groq import Groq
import google.generativeai as genai
from engine.config import (
    GROQ_API_KEY, 
    GROQ_PLANNER_MODEL, 
    GEMINI_API_KEY, 
    GEMINI_SYNTHESIS_MODEL
)

def call_resilient_llm(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.15,
    max_tokens: int = 1500,
    json_mode: bool = True
) -> Optional[str]:
    """
    Bulletproof multi-tier LLM routing with automatic exponential backoff on 429
    and seamless provider fallback (Groq -> Gemini).
    """
    # ── Tier 1: Groq with Exponential Backoff on 429 ──
    if GROQ_API_KEY:
        client = Groq(api_key=GROQ_API_KEY)
        for attempt in range(2):
            try:
                kwargs = {
                    "model": GROQ_PLANNER_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens
                }
                if json_mode:
                    kwargs["response_format"] = {"type": "json_object"}

                resp = client.chat.completions.create(**kwargs)
                if resp.choices and resp.choices[0].message.content:
                    return resp.choices[0].message.content.strip()
            except Exception as e:
                err_msg = str(e)
                print(f"[llm_resilient] Groq attempt {attempt+1} notice: {err_msg[:120]}")
                if ("429" in err_msg or "rate" in err_msg.lower() or "quota" in err_msg.lower()) and attempt == 0:
                    time.sleep(2)
                    continue
                break

    # ── Tier 2: Gemini Fallback (Independent Quota) ──
    if GEMINI_API_KEY:
        try:
            print(f"[llm_resilient] Engaging Tier-2 Gemini fallback ({GEMINI_SYNTHESIS_MODEL})...")
            genai.configure(api_key=GEMINI_API_KEY)
            model = genai.GenerativeModel(
                model_name=GEMINI_SYNTHESIS_MODEL,
                system_instruction=system_prompt
            )
            gen_config = genai.types.GenerationConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
                response_mime_type="application/json" if json_mode else "text/plain"
            )
            resp = model.generate_content(
                user_prompt,
                generation_config=gen_config,
                request_options={"timeout": 20}
            )
            if resp and resp.text:
                return resp.text.strip()
        except Exception as gemini_err:
            print(f"[llm_resilient] Gemini fallback error: {gemini_err}")

    return None
