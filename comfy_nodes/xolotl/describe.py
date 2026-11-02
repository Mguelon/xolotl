"""What the character looks like, in words: a small vision-language model reads the character picture and writes the
sentence H3's prompt needs. Without it a 13 s take showed the performer in 9 of 26 sampled frames, her cropped top and
her face through the turn; with the character described, in none (docs/measurements.md, "The character described").

The model is a Hugging Face folder in ComfyUI's models/LLM (config, weights, processor), loaded once with transformers
and kept in RAM between descriptions so the GPU stays free for the swap: each description makes room through ComfyUI's
memory manager, moves the model to the GPU, writes greedily and moves it back.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np
import torch

DEFAULT_MODEL = "Qwen3.5-0.8B"
INSTRUCTION = (
    "Describe the person in this picture so that a video model can draw them again. Write one paragraph that starts "
    "with \"The character is\". Give their apparent age and build; their hair colour, length and style; their eye "
    "colour and features such as eyebrows, freckles or make-up; every garment with its colour, type and fit, and how "
    "far it reaches on the body, for example a sweater that reaches the waistband of the jeans; and the shoes. Do not "
    "describe the background, the pose or the facial expression."
)
_loaded: dict[str, tuple] = {}


def load(folder: Path):
    """The model and its processor, read from disk the first time only."""
    key = str(folder)
    if key not in _loaded:
        from transformers import AutoModelForImageTextToText, AutoProcessor

        start = time.perf_counter()
        processor = AutoProcessor.from_pretrained(folder)
        model = AutoModelForImageTextToText.from_pretrained(folder, dtype=torch.bfloat16).eval()
        _loaded[key] = (model, processor)
        logging.info("Xólotl: loaded %s in %.1f s", folder.name, time.perf_counter() - start)
    return _loaded[key]


def describe(picture: np.ndarray, folder: Path, instruction: str = INSTRUCTION, max_side: int = 1024,
             max_new_tokens: int = 200, device: str = "cuda") -> str:
    """One paragraph about the person in `picture` (H×W×3 uint8), the longest side brought down to `max_side`."""
    from PIL import Image

    model, processor = load(folder)
    image = Image.fromarray(picture)
    if max(image.size) > max_side:
        scale = max_side / max(image.size)
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": instruction}]}]
    try:  # Qwen3.5 thinks unless told not to; other templates take no such switch
        prompt = processor.apply_chat_template(messages, add_generation_prompt=True, enable_thinking=False)
    except TypeError:
        prompt = processor.apply_chat_template(messages, add_generation_prompt=True)
    inputs = processor(text=prompt, images=[image], return_tensors="pt")
    if device != "cpu":
        import comfy.model_management as mm

        mm.free_memory(int(sum(p.numel() * p.element_size() for p in model.parameters()) * 1.5), mm.get_torch_device())
    model.to(device)
    try:
        inputs = {k: (v.to(device, dtype=model.dtype) if v.is_floating_point() else v.to(device)) if torch.is_tensor(v) else v
                  for k, v in inputs.items()}
        with torch.inference_mode():
            out = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
        text = processor.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0]
    finally:
        model.to("cpu")
        if device != "cpu":
            torch.cuda.empty_cache()
    return " ".join(text.split())
