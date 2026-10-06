"""Local model-backed Research System for DamdAImin.

The service is intentionally stateless. It receives one WAV payload, runs ASR,
the fine-tuned TSERA model, and the preliminary symbolic layer, then returns
the versioned Research System response consumed by the DamdAImin worker.

The TSERA model implementation is vendored read-only from the research
repository. This keeps preprocessing and checkpoint loading identical to the
research repository without requiring the full research checkout at runtime.
"""

from __future__ import annotations

import base64
import binascii
import csv
import json
import os
import re
import sys
import tempfile
import threading
import unicodedata
from collections import defaultdict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel


TSERA_SOURCE_DIR = Path(os.getenv("TSERA_SOURCE_DIR", "/app/vendor/tsera/src"))
if str(TSERA_SOURCE_DIR) not in sys.path:
    sys.path.insert(0, str(TSERA_SOURCE_DIR))

from app.tsera_inference import (  # noqa: E402
    DEFAULT_CONFIG,
    LoadedModel,
    load_checkpoint,
    predict_audio_file,
)
from audio_windows import infer_recording_probabilities  # noqa: E402


EMOTION_LABELS = ["angry", "happy", "neutral", "sad"]
NO_RULE_SYMBOLIC_PRIOR = {
    "angry": 0.10,
    "happy": 0.10,
    "neutral": 0.70,
    "sad": 0.10,
}
NEUTRAL_RULE_SYMBOLIC_MIN_PROBABILITY = 0.65
CONTRACT_EMOTION = {
    "angry": "anger",
    "happy": "happiness",
    "neutral": "neutrality",
    "sad": "sadness",
}
RULE_NAMES = ["lexical", "code_switch", "prosodic", "contrast", "contradiction"]
COMPONENT_NAMES = [*RULE_NAMES, "agreement"]
RULE_DESCRIPTIONS = {
    "lexical": "Lexical Rules recognize emotion-bearing words, modifiers, profanity or aggression, politeness, and negation cues.",
    "code_switch": "Code-Switch Detection identifies token-level alternation between Filipino and English.",
    "prosodic": "Prosodic Rules use energy and speaking-rate evidence as supplementary emotional cues.",
    "contrast": "Contrast-aware Rules interpret the post-contrast clause when discourse markers signal a contrast or concession.",
    "contradiction": "Contradiction Rules identify disagreement between neural and symbolic emotional evidence.",
    "agreement": "Neural-rule Agreement boosts the symbolic score when the neural model's top emotion has positive support from an active rule.",
}
RULE_IDS = {
    "lexical": "lexical-context",
    "code_switch": "code-switch-context",
    "prosodic": "prosodic-context",
    "contrast": "contrast-context",
    "contradiction": "contradiction-context",
    "agreement": "neural-rule-agreement",
}
RULE_WEIGHTS = {
    "lexical": float(os.getenv("RULE_WEIGHT_LEXICAL", "1.00")),
    "code_switch": float(os.getenv("RULE_WEIGHT_CODE_SWITCH", "1.00")),
    "prosodic": float(os.getenv("RULE_WEIGHT_PROSODIC", "1.00")),
    "contrast": float(os.getenv("RULE_WEIGHT_CONTRAST", "1.00")),
    "contradiction": float(os.getenv("RULE_WEIGHT_CONTRADICTION", "1.00")),
    # Stronger default keeps supported neural-rule agreement distinct in the symbolic distribution.
    "agreement": float(os.getenv("RULE_WEIGHT_AGREEMENT", "2.50")),
}

SAMPLE_RATE = 16_000
NEURAL_FUSION_WEIGHT = float(os.getenv("NEURAL_FUSION_WEIGHT", "0.60"))
SYMBOLIC_FUSION_WEIGHT = float(os.getenv("SYMBOLIC_FUSION_WEIGHT", "0.40"))
FUSION_WEIGHT_TOTAL = NEURAL_FUSION_WEIGHT + SYMBOLIC_FUSION_WEIGHT
if NEURAL_FUSION_WEIGHT < 0 or SYMBOLIC_FUSION_WEIGHT < 0 or FUSION_WEIGHT_TOTAL <= 0:
    raise ValueError(
        "Neural and symbolic fusion weights must be non-negative and sum to more than zero."
    )
BASE_SYMBOLIC_FUSION_WEIGHT = SYMBOLIC_FUSION_WEIGHT / FUSION_WEIGHT_TOTAL
MAX_SYMBOLIC_FUSION_WEIGHT = 0.90
UNCERTAINTY_SYMBOLIC_WEIGHT_BONUS = 0.15
CONTEXT_SUPPORT_SYMBOLIC_WEIGHT_BONUS = 0.05
CONTEXT_CONFLICT_SYMBOLIC_WEIGHT_BONUS = 0.60
CONTEXT_EVIDENCE_SATURATION = 0.40
CONTEXT_EVIDENCE_CATEGORIES = ("lexical", "contrast")
MODEL_VERSION = os.getenv("MODEL_VERSION", "tsera-finetuned-baseline")
ASR_MODEL_NAME = os.getenv("ASR_MODEL", "large-v3-turbo")
ASR_LANGUAGE = os.getenv("ASR_LANGUAGE", "auto").strip().casefold()
ASR_DEVICE = os.getenv("ASR_DEVICE", "cpu")
ASR_COMPUTE_TYPE = os.getenv("ASR_COMPUTE_TYPE", "int8")
MODEL_PATH = Path(
    os.getenv(
        "TSERA_MODEL_PATH",
        "/app/vendor/tsera/src/models/best_finetuned_baseline.pt",
    )
)
KEYWORD_DIR = Path(
    os.getenv("SYMBOLIC_KEYWORD_DIR", "/app/vendor/tsera/data/raw/keywords")
)


def normalize_text(value: Any) -> str:
    value = unicodedata.normalize("NFKC", str(value))
    value = value.replace("’", "'").casefold()
    return re.sub(r"\s+", " ", value).strip()



TOKEN_RE = re.compile(
    r"[^\W_]+(?:[$*@][^\W_]*)*(?:['-][^\W_]+(?:[$*@][^\W_]*)*)*",
    flags=re.UNICODE,
)
FILIPINO_STEM_INDEX_KEY = "__filipino_stems__"
FILIPINO_STEM_MIN_LENGTH = 5
FILIPINO_STEM_MAX_LENGTH_DIFFERENCE = 6


def tokenize(text: str) -> list[str]:
    return [match.group(0) for match in TOKEN_RE.finditer(normalize_text(text))]


def expand_variants(value: Any) -> list[str]:
    return [
        normalize_text(item)
        for item in str(value or "").split(";")
        if normalize_text(item)
    ]


def strength_value(value: Any) -> float:
    normalized = normalize_text(value).replace("–", "-")
    return {
        "low": 0.50,
        "medium": 0.75,
        "medium/high": 1.00,
        "medium-high": 1.00,
        "high": 1.25,
        "very high": 1.50,
        "extreme": 1.50,
    }.get(normalized, 0.75)


def emotion_targets(value: Any) -> dict[str, float]:
    normalized = normalize_text(value)
    if normalized in EMOTION_LABELS:
        return {normalized: 1.0}
    # Positive valence and preferences are not sufficient evidence of happiness.
    if normalized == "positive":
        return {}
    if normalized == "sad/neutral":
        return {"sad": 0.5, "neutral": 0.5}
    return {}


def read_rows(filename_candidates: list[str]) -> list[dict[str, str]]:
    path = next(
        (KEYWORD_DIR / filename for filename in filename_candidates if (KEYWORD_DIR / filename).is_file()),
        None,
    )
    if path is None:
        raise FileNotFoundError(
            "Missing symbolic keyword resource; expected one of {} in {}".format(
                filename_candidates,
                KEYWORD_DIR,
            )
        )
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def make_entries(
    rows: list[dict[str, str]],
    field: str,
    subtype: str,
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    seen: set[tuple[tuple[str, ...], str, str]] = set()
    for row in rows:
        terms = [row.get(field, "")]
        terms.extend(expand_variants(row.get("common_variants", "")))
        for term in terms:
            normalized = normalize_text(term)
            token_tuple = tuple(tokenize(normalized))
            if not token_tuple:
                continue
            identifier = row.get(
                "emotion_lexicon_id",
                row.get("lexicon_id", row.get("marker_id", "")),
            )
            signature = (token_tuple, subtype, identifier)
            if signature in seen:
                continue
            seen.add(signature)
            entries.append(
                {
                    "text": normalized,
                    "tokens": token_tuple,
                    "subtype": subtype,
                    "row": row,
                    "strength": strength_value(
                        row.get("strength", row.get("severity", "medium"))
                    ),
                }
            )
    return entries


def index_entries(
    entries: list[dict[str, Any]],
    include_filipino_stems: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    indexed: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        indexed[entry["tokens"][0]].append(entry)
        if include_filipino_stems and len(entry["tokens"]) == 1:
            language_values = normalize_text(entry["row"].get("language", "")).split("/")
            languages = {
                language.strip() for language in language_values
            }
            if "filipino" in languages:
                indexed[FILIPINO_STEM_INDEX_KEY].append(entry)
    for token in indexed:
        indexed[token].sort(key=lambda item: len(item["tokens"]), reverse=True)
    return indexed


def is_filipino_stem_variant(transcript_token: str, lexicon_token: str) -> bool:
    shorter, longer = sorted((transcript_token, lexicon_token), key=len)
    return (
        len(shorter) >= FILIPINO_STEM_MIN_LENGTH
        and len(longer) - len(shorter) <= FILIPINO_STEM_MAX_LENGTH_DIFFERENCE
        and shorter in longer
    )


def find_matches(
    tokens: list[str],
    indexed_entries: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for start, token in enumerate(tokens):
        exact_matches = []
        for entry in indexed_entries.get(token, []):
            length = len(entry["tokens"])
            if tuple(tokens[start : start + length]) == entry["tokens"]:
                match = dict(entry)
                match["start"] = start
                match["end"] = start + length - 1
                exact_matches.append(match)

        if exact_matches:
            candidates.extend(exact_matches)
            continue

        for entry in indexed_entries.get(FILIPINO_STEM_INDEX_KEY, []):
            lexicon_token = entry["tokens"][0]
            if is_filipino_stem_variant(token, lexicon_token):
                match = dict(entry)
                match["text"] = token
                match["match_type"] = "shared_stem"
                match["stem_length_difference"] = abs(len(token) - len(lexicon_token))
                match["start"] = start
                match["end"] = start
                candidates.append(match)

    candidates.sort(
        key=lambda item: (
            item["start"],
            -(item["end"] - item["start"] + 1),
            item.get("stem_length_difference", 0),
        )
    )
    selected: list[dict[str, Any]] = []
    occupied: set[int] = set()
    for match in candidates:
        span = set(range(match["start"], match["end"] + 1))
        if occupied.intersection(span):
            continue
        selected.append(match)
        occupied.update(span)
    return selected


def softmax(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    shifted = values - np.max(values)
    exp_values = np.exp(shifted)
    return (exp_values / exp_values.sum()).astype(np.float32)


def build_symbolic_score_journey(traces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """replay weighted rule contributions in transcript order for the UI."""
    running = np.zeros(len(EMOTION_LABELS), dtype=np.float64)
    journey = [
        {
            "cue": "Starting symbolic scores",
            "ruleId": "BASELINE",
            "source": "baseline",
            "scores": probability_breakdown(
                np.full(len(EMOTION_LABELS), 1.0 / len(EMOTION_LABELS), dtype=np.float32)
            ),
        }
    ]
    candidates = []
    for index, trace in enumerate(traces):
        contribution = trace.get("score_contribution")
        if not contribution:
            continue
        category = str(trace["rule_category"])
        vector = np.zeros(len(EMOTION_LABELS), dtype=np.float64)
        for label, value in contribution.items():
            if label in EMOTION_LABELS:
                vector[EMOTION_LABELS.index(label)] += (
                    float(value) * RULE_WEIGHTS.get(category, 1.0)
                )
        if not np.any(vector):
            continue
        cue_span = trace.get("cue_span")
        order = trace.get(
            "journey_position",
            cue_span[0] if isinstance(cue_span, list) and cue_span else 10**9,
        )
        source = "acoustic" if category == "prosodic" else (
            "system" if category in {"agreement", "contradiction"} else "linguistic"
        )
        candidates.append((order, index, trace, vector, source))

    for _order, _index, trace, vector, source in sorted(candidates, key=lambda item: (item[0], item[1])):
        running += vector
        cue = str(trace.get("journey_cue", trace.get("cue", trace["rule_id"])))
        journey.append(
            {
                "cue": cue,
                "ruleId": str(trace["rule_id"]),
                "source": source,
                "scores": probability_breakdown(softmax(running)),
            }
        )
    return journey


class SymbolicReasoner:
    """Preliminary five-tier symbolic layer for the local demonstration."""

    def __init__(self) -> None:
        self.rule_weights = dict(RULE_WEIGHTS)
        emotion_rows = read_rows(["THESIS-emotion_words.csv"])
        intensifier_rows = read_rows(["THESIS-intensifier_words.csv"])
        negation_rows = read_rows(["THESIS-negation_words.csv"])
        profanity_rows = read_rows(
            ["THESIS-profanity_words.csv", "THESIS-profane_words.csv"]
        )
        transition_rows = read_rows(["THESIS-transition_words.csv"])

        emotion_entries = []
        for entry in make_entries(emotion_rows, "term", "emotion_expression"):
            entry["targets"] = emotion_targets(entry["row"].get("emotion_class", ""))
            if entry["targets"]:
                emotion_entries.append(entry)

        self.emotion_index = index_entries(
            emotion_entries,
            include_filipino_stems=True,
        )
        self.intensifier_index = index_entries(
            make_entries(intensifier_rows, "intensifier", "intensifier_or_downtoner")
        )
        self.negation_index = index_entries(
            make_entries(negation_rows, "negator", "negation")
        )
        self.profanity_index = index_entries(
            make_entries(profanity_rows, "term", "profanity_or_aggression")
        )
        contrast_entries = [
            entry
            for entry in make_entries(
                transition_rows,
                "marker",
                "contrast_or_concession",
            )
            if any(
                word in normalize_text(entry["row"].get("discourse_function", ""))
                for word in ("contrast", "concession")
            )
        ]
        self.contrast_index = index_entries(contrast_entries)

        self.english_tokens = {
            "i", "you", "he", "she", "we", "they", "it", "the", "a", "an",
            "is", "are", "was", "were", "to", "of", "and", "but", "so", "very",
            "not", "no", "never", "my", "our", "this", "that", "with", "for",
            "in", "on", "please", "sorry",
        }
        self.filipino_tokens = {
            "ako", "ikaw", "siya", "kami", "tayo", "sila", "ang", "ng", "mga",
            "sa", "na", "naman", "pero", "kasi", "kaya", "hindi", "di", "wala",
            "at", "ito", "iyon", "yung", "ko", "mo", "niya", "para", "may", "lang",
            "eh", "po", "opo",
        }
        for rows in (
            emotion_rows,
            intensifier_rows,
            negation_rows,
            profanity_rows,
            transition_rows,
        ):
            for row in rows:
                language = normalize_text(row.get("language", ""))
                row_tokens: set[str] = set()
                for field in ("term", "intensifier", "negator", "marker"):
                    row_tokens.update(tokenize(row.get(field, "")))
                    for variant in expand_variants(row.get("common_variants", "")):
                        row_tokens.update(tokenize(variant))
                if "english" in language:
                    self.english_tokens.update(row_tokens)
                if any(word in language for word in ("filipino", "tagalog", "philippine")):
                    self.filipino_tokens.update(row_tokens)

        self.politeness_tokens = {"po", "opo", "please", "paki", "pakiusap", "sorry"}

    def token_language(self, token: str) -> str:
        normalized = normalize_text(token)
        english = normalized in self.english_tokens
        filipino = normalized in self.filipino_tokens
        if english and filipino:
            return "mixed"
        if english:
            return "english"
        if filipino:
            return "filipino"
        return "unknown"

    def analyze(
        self,
        transcript: str,
        waveform: np.ndarray,
        sample_rate: int,
        neural_probabilities: np.ndarray,
    ) -> dict[str, Any]:
        tokens = tokenize(transcript)
        components = {
            name: np.zeros(len(EMOTION_LABELS), dtype=np.float32)
            for name in COMPONENT_NAMES
        }
        traces: list[dict[str, Any]] = []
        emotion_matches = find_matches(tokens, self.emotion_index)
        intensifier_matches = find_matches(tokens, self.intensifier_index)
        negation_matches = find_matches(tokens, self.negation_index)
        profanity_matches = find_matches(tokens, self.profanity_index)
        contrast_matches = find_matches(tokens, self.contrast_index)

        lexical_count = 0
        for match in emotion_matches:
            targets = match["targets"]
            modifiers = [
                item
                for item in intensifier_matches
                if 0 <= match["start"] - item["end"] <= 2
            ]
            negation = next(
                (
                    item
                    for item in negation_matches
                    if 0 <= match["start"] - item["end"] <= 3
                ),
                None,
            )
            negated = negation is not None
            modifier_scale = 1.0 + 0.25 * max(
                [item["strength"] for item in modifiers],
                default=0.0,
            )
            sign = -0.5 if negated else 1.0
            evidence = float(0.20 * match["strength"] * modifier_scale * sign)
            contribution = {}
            for label, share in targets.items():
                components["lexical"][EMOTION_LABELS.index(label)] += evidence * share
                contribution[label] = evidence * share
            lexical_count += 1
            traces.append(
                {
                    "rule_id": "LEXICAL_EMOTION",
                    "rule_category": "lexical",
                    "cue": match["text"],
                    "cue_span": [match["start"], match["end"]],
                    "target_emotion": list(targets),
                    "direction": "decrease" if negated else "increase",
                    "reported_adjustment": evidence,
                    "score_contribution": contribution,
                    "journey_cue": " ".join(
                        [item["text"] for item in sorted(
                            [*modifiers, *([negation] if negation else [])],
                            key=lambda item: item["start"],
                        )]
                        + [match["text"]]
                    ),
                    "activated": True,
                }
            )

        for match in intensifier_matches:
            affected = [
                item
                for item in emotion_matches
                if 0 <= item["start"] - match["end"] <= 2
            ]
            if affected:
                traces.append(
                    {
                        "rule_id": "LEXICAL_MODIFIER",
                        "rule_category": "lexical",
                        "cue": match["text"],
                        "cue_span": [match["start"], match["end"]],
                        "target_emotion": [
                            label for item in affected for label in item["targets"]
                        ],
                        "direction": "increase",
                        "reported_adjustment": float(0.25 * match["strength"]),
                        "activated": True,
                    }
                )

        for match in negation_matches:
            affected = [
                item
                for item in emotion_matches
                if 0 <= item["start"] - match["end"] <= 3
            ]
            if affected:
                traces.append(
                    {
                        "rule_id": "LEXICAL_NEGATION",
                        "rule_category": "lexical",
                        "cue": match["text"],
                        "cue_span": [match["start"], match["end"]],
                        "target_emotion": [
                            label for item in affected for label in item["targets"]
                        ],
                        "direction": "decrease",
                        "reported_adjustment": -0.5,
                        "activated": True,
                    }
                )

        for match in profanity_matches:
            evidence = float(0.08 * match["strength"])
            components["lexical"][EMOTION_LABELS.index("angry")] += evidence
            traces.append(
                {
                    "rule_id": "LEXICAL_PROFANITY",
                    "rule_category": "lexical",
                    "cue": match["text"],
                    "cue_span": [match["start"], match["end"]],
                    "target_emotion": ["angry"],
                    "direction": "increase",
                    "reported_adjustment": evidence,
                    "score_contribution": {"angry": evidence},
                    "activated": True,
                }
            )

        for token in tokens:
            if token in self.politeness_tokens:
                traces.append(
                    {
                        "rule_id": "LEXICAL_POLITENESS",
                        "rule_category": "lexical",
                        "cue": token,
                        "cue_span": [tokens.index(token), tokens.index(token)],
                        "target_emotion": ["angry"],
                        "direction": "decrease",
                        "reported_adjustment": -0.03,
                        "score_contribution": {"angry": -0.03},
                        "activated": True,
                    }
                )
                components["lexical"][EMOTION_LABELS.index("angry")] -= 0.03

        language_tags = [self.token_language(token) for token in tokens]
        switch_points = [
            index
            for index in range(1, len(language_tags))
            if language_tags[index - 1] in {"english", "filipino"}
            and language_tags[index] in {"english", "filipino"}
            and language_tags[index - 1] != language_tags[index]
        ]
        lexical_peak = (
            int(np.argmax(components["lexical"]))
            if np.any(components["lexical"] > 0)
            else None
        )
        if switch_points and lexical_peak is not None:
            components["code_switch"][lexical_peak] += 0.05
        if switch_points:
            traces.append(
                {
                    "rule_id": "CODE_SWITCH_TOKEN_LID",
                    "rule_category": "code_switch",
                    "cue": "token-level language switch",
                    "cue_span": switch_points,
                    "target_emotion": (
                        [EMOTION_LABELS[lexical_peak]] if lexical_peak is not None else []
                    ),
                    "direction": "support" if lexical_peak is not None else "none",
                    "reported_adjustment": 0.05 if lexical_peak is not None else 0.0,
                    "score_contribution": (
                        {EMOTION_LABELS[lexical_peak]: 0.05}
                        if lexical_peak is not None
                        else {}
                    ),
                    "activated": True,
                    "language_tags": language_tags,
                }
            )

        waveform = np.asarray(waveform, dtype=np.float32).reshape(-1)
        duration = max(float(len(waveform)) / max(sample_rate, 1), 0.1)
        rms = float(np.sqrt(np.mean(np.square(waveform)))) if len(waveform) else 0.0
        speech_rate = float(len(tokens) / duration)
        if rms >= 0.08 or speech_rate >= 3.5:
            components["prosodic"][EMOTION_LABELS.index("angry")] += 0.05
            traces.append(
                {
                    "rule_id": "PROSODIC_ENERGY_RATE",
                    "rule_category": "prosodic",
                    "cue": "energy and speaking rate",
                    "target_emotion": ["angry"],
                    "direction": "increase",
                    "reported_adjustment": 0.05,
                    "score_contribution": {"angry": 0.05},
                    "activated": True,
                    "features": {"rms": rms, "speech_rate_tokens_per_second": speech_rate},
                }
            )
        elif rms <= 0.025 and speech_rate <= 1.5:
            components["prosodic"][EMOTION_LABELS.index("sad")] += 0.05
            traces.append(
                {
                    "rule_id": "PROSODIC_ENERGY_RATE",
                    "rule_category": "prosodic",
                    "cue": "energy and speaking rate",
                    "target_emotion": ["sad"],
                    "direction": "increase",
                    "reported_adjustment": 0.05,
                    "score_contribution": {"sad": 0.05},
                    "activated": True,
                    "features": {"rms": rms, "speech_rate_tokens_per_second": speech_rate},
                }
            )

        affected_by_marker: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for emotion_match in emotion_matches:
            preceding_markers = [
                (index, marker)
                for index, marker in enumerate(contrast_matches)
                if marker["end"] < emotion_match["start"]
            ]
            if preceding_markers:
                marker_index, _marker = max(
                    preceding_markers,
                    key=lambda item: item[1]["end"],
                )
                affected_by_marker[marker_index].append(emotion_match)

        for marker_index, affected in affected_by_marker.items():
            marker = contrast_matches[marker_index]
            contribution = {}
            for item in affected:
                base = 0.05 * item["strength"]
                for label, share in item["targets"].items():
                    components["contrast"][EMOTION_LABELS.index(label)] += base * share
                    contribution[label] = contribution.get(label, 0.0) + base * share
            traces.append(
                {
                    "rule_id": "CONTRAST_POST_CLAUSE",
                    "rule_category": "contrast",
                    "cue": marker["text"],
                    "cue_span": [marker["start"], marker["end"]],
                    "target_emotion": [
                        label for item in affected for label in item["targets"]
                    ],
                    "direction": "increase",
                    "reported_adjustment": float(
                        sum(0.05 * item["strength"] for item in affected)
                    ),
                    "score_contribution": contribution,
                    "journey_cue": f"{marker['text']} → " + ", ".join(
                        item["text"] for item in affected
                    ),
                    "journey_position": min(item["start"] for item in affected),
                    "activated": True,
                    "scope": "post-contrast clause",
                }
            )

        neural_index = int(np.argmax(neural_probabilities))
        context_scores = sum(
            (
                self.rule_weights[name] * components[name]
                for name in CONTEXT_EVIDENCE_CATEGORIES
            ),
            start=np.zeros(4, dtype=np.float32),
        )
        symbolic_scores = sum(
            (
                self.rule_weights[name] * values
                for name, values in components.items()
            ),
            start=np.zeros(4, dtype=np.float32),
        )
        contradiction_active = False
        if np.any(symbolic_scores > 0):
            symbolic_index = int(np.argmax(symbolic_scores))
            if neural_index != symbolic_index:
                components["contradiction"][symbolic_index] -= 0.05
                contradiction_active = True
                traces.append(
                    {
                        "rule_id": "CONTRADICTION_RECALIBRATION",
                        "rule_category": "contradiction",
                        "cue": "neural-symbolic disagreement",
                        "target_emotion": [EMOTION_LABELS[symbolic_index]],
                        "direction": "decrease",
                        "reported_adjustment": -0.05,
                        "score_contribution": {EMOTION_LABELS[symbolic_index]: -0.05},
                        "activated": True,
                    }
                )

        neural_emotion = EMOTION_LABELS[neural_index]
        supporting_rule_categories = [
            name
            for name in RULE_NAMES
            if components[name][neural_index] > 0
        ]
        if supporting_rule_categories:
            supporting_rules = [
                str(trace["rule_id"])
                for trace in traces
                if trace.get("activated")
                and neural_emotion in trace.get("target_emotion", [])
                and float(trace.get("reported_adjustment", 0.0)) > 0
            ]
            agreement_evidence = float(neural_probabilities[neural_index])
            components["agreement"][neural_index] += agreement_evidence
            traces.append(
                {
                    "rule_id": "NEURAL_RULE_AGREEMENT",
                    "rule_category": "agreement",
                    "cue": "neural prediction corroborated by positive rule evidence",
                    "target_emotion": [neural_emotion],
                    "direction": "increase",
                    "reported_adjustment": agreement_evidence,
                    "score_contribution": {neural_emotion: agreement_evidence},
                    "activated": True,
                    "supporting_rules": supporting_rules,
                }
            )

        has_rule_evidence = any(np.any(components[name] != 0) for name in RULE_NAMES)
        positive_rule_targets = {
            label
            for trace in traces
            if trace.get("activated")
            and trace.get("rule_category") not in {"agreement", "contradiction"}
            and float(trace.get("reported_adjustment", 0.0)) > 0
            for label in trace.get("target_emotion", [])
        }
        neutral_only_rule_support = (
            "neutral" in positive_rule_targets
            and positive_rule_targets <= {"neutral"}
        )
        weighted_scores = sum(
            (
                self.rule_weights[name] * values
                for name, values in components.items()
            ),
            start=np.zeros(4, dtype=np.float32),
        )
        if has_rule_evidence:
            symbolic_probabilities = softmax(weighted_scores)
            if neutral_only_rule_support:
                neutral_index = EMOTION_LABELS.index("neutral")
                other_emotions = np.arange(len(EMOTION_LABELS)) != neutral_index
                other_probability = float(symbolic_probabilities[other_emotions].sum())
                if (
                    symbolic_probabilities[neutral_index]
                    < NEUTRAL_RULE_SYMBOLIC_MIN_PROBABILITY
                ):
                    symbolic_probabilities[other_emotions] *= (
                        (1.0 - NEUTRAL_RULE_SYMBOLIC_MIN_PROBABILITY)
                        / max(other_probability, 1e-8)
                    )
                    symbolic_probabilities[neutral_index] = (
                        NEUTRAL_RULE_SYMBOLIC_MIN_PROBABILITY
                    )
        else:
            symbolic_probabilities = np.array(
                [NO_RULE_SYMBOLIC_PRIOR[label] for label in EMOTION_LABELS],
                dtype=np.float32,
            )
        score_journey = build_symbolic_score_journey(traces)
        symbolic_final = probability_breakdown(symbolic_probabilities)
        if not has_rule_evidence:
            score_journey = [
                {
                    "cue": "No symbolic clues matched",
                    "ruleId": "BASELINE",
                    "source": "baseline",
                    "scores": symbolic_final,
                }
            ]
        elif len(score_journey) > 1:
            previous_scores = score_journey[-1]["scores"]
            if any(
                abs(previous_scores[key] - symbolic_final[key]) > 1e-6
                for key in symbolic_final
            ):
                score_journey.append(
                    {
                        "cue": "Neutral-only score floor",
                        "ruleId": "NEUTRAL_RULE_FLOOR",
                        "source": "system",
                        "scores": symbolic_final,
                    }
                )
            else:
                score_journey[-1]["scores"] = symbolic_final
        return {
            "symbolic_probabilities": symbolic_probabilities,
            "context_scores": context_scores,
            "traces": traces,
            "score_journey": score_journey,
            "recognized_lexical_cues": lexical_count,
            "contradiction_active": contradiction_active,
            "tokens": tokens,
        }


def probability_breakdown(probabilities: np.ndarray) -> dict[str, float]:
    return {
        CONTRACT_EMOTION[label]: float(probabilities[index])
        for index, label in enumerate(EMOTION_LABELS)
    }


def calculate_dynamic_fusion_weights(
    neural_probabilities: np.ndarray,
    context_scores: np.ndarray,
) -> dict[str, Any]:
    """Scale symbolic influence to neural uncertainty and emotion-bearing context."""
    normalized_neural = np.asarray(neural_probabilities, dtype=np.float64).reshape(-1)
    normalized_neural = np.clip(normalized_neural, 1e-8, None)
    normalized_neural /= max(float(normalized_neural.sum()), 1e-8)
    entropy = -float(np.sum(normalized_neural * np.log(normalized_neural)))
    uncertainty = float(
        np.clip(entropy / np.log(len(EMOTION_LABELS)), 0.0, 1.0)
    )

    positive_context_scores = np.maximum(
        np.asarray(context_scores, dtype=np.float64).reshape(-1),
        0.0,
    )
    total_context_support = float(positive_context_scores.sum())
    context_index: int | None = None
    context_strength = 0.0
    if total_context_support > 0:
        context_index = int(np.argmax(positive_context_scores))
        ranked_scores = np.sort(positive_context_scores)
        strongest_score = float(ranked_scores[-1])
        second_score = float(ranked_scores[-2])
        evidence_volume = min(
            total_context_support / CONTEXT_EVIDENCE_SATURATION,
            1.0,
        )
        evidence_clarity = max(strongest_score - second_score, 0.0) / max(
            strongest_score,
            1e-8,
        )
        context_strength = float(
            np.clip(evidence_volume * evidence_clarity, 0.0, 1.0)
        )

    neural_index = int(np.argmax(normalized_neural))
    context_emotion = (
        EMOTION_LABELS[context_index]
        if context_index is not None and context_strength > 0
        else None
    )
    context_conflict = context_emotion is not None and context_index != neural_index
    if context_emotion is None:
        context_bonus = 0.0
    elif context_conflict:
        context_bonus = CONTEXT_CONFLICT_SYMBOLIC_WEIGHT_BONUS * context_strength
    else:
        context_bonus = CONTEXT_SUPPORT_SYMBOLIC_WEIGHT_BONUS * context_strength

    symbolic_weight = min(
        BASE_SYMBOLIC_FUSION_WEIGHT
        + UNCERTAINTY_SYMBOLIC_WEIGHT_BONUS * uncertainty
        + context_bonus,
        MAX_SYMBOLIC_FUSION_WEIGHT,
    )
    neural_weight = 1.0 - symbolic_weight

    if context_conflict:
        if context_strength >= 0.60:
            reason = (
                f"strong contextual evidence for {context_emotion} conflicted "
                "with the neural prediction"
            )
        else:
            reason = (
                f"contextual evidence for {context_emotion} conflicted "
                "with the neural prediction"
            )
    elif context_emotion is not None:
        reason = f"contextual evidence also supported {context_emotion}"
    elif uncertainty >= 0.65:
        reason = (
            "neural probabilities were uncertain, so the neutral-leaning prior "
            "had more influence"
        )
    else:
        reason = (
            "the neural prediction was relatively certain and contextual evidence "
            "was limited"
        )

    return {
        "neural_weight": neural_weight,
        "symbolic_weight": symbolic_weight,
        "neural_uncertainty": uncertainty,
        "context_strength": context_strength,
        "context_emotion": context_emotion,
        "context_conflict": context_conflict,
        "reason": reason,
    }


def to_contract_emotion(label: str) -> str:
    return CONTRACT_EMOTION[label]


class ResearchRuntime:
    def __init__(self) -> None:
        if not MODEL_PATH.is_file():
            raise FileNotFoundError(f"Fine-tuned checkpoint not found: {MODEL_PATH}")
        self.loaded_model: LoadedModel = load_checkpoint(MODEL_PATH, device="cpu")
        self.reasoner = SymbolicReasoner()
        self.asr: WhisperModel | None = None
        self.lock = threading.Lock()
        self.ensure_asr()

    def ensure_asr(self) -> WhisperModel:
        if self.asr is None:
            self.asr = WhisperModel(
                ASR_MODEL_NAME,
                device=ASR_DEVICE,
                compute_type=ASR_COMPUTE_TYPE,
            )
        return self.asr

    def transcribe(self, path: Path) -> tuple[str, list[dict[str, Any]]]:
        model = self.ensure_asr()
        language = None if ASR_LANGUAGE in {"", "auto"} else ASR_LANGUAGE
        segments, info = model.transcribe(
            str(path),
            language=language,
            task="transcribe",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        segment_list = [
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": segment.text.strip(),
            }
            for segment in segments
        ]
        transcript = " ".join(item["text"] for item in segment_list).strip()
        if not transcript:
            transcript = ""
        return transcript, segment_list

    def transcribe_audio(self, audio_bytes: bytes) -> str:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            handle.write(audio_bytes)
            temporary_path = Path(handle.name)
        try:
            transcript, _segments = self.transcribe(temporary_path)
            return transcript
        finally:
            temporary_path.unlink(missing_ok=True)

    def analyze(
        self,
        audio_bytes: bytes,
        contract_version: str,
        transcript_override: str | None = None,
    ) -> dict[str, Any]:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            handle.write(audio_bytes)
            temporary_path = Path(handle.name)
        try:
            if transcript_override is None:
                transcript, asr_segments = self.transcribe(temporary_path)
            else:
                transcript, asr_segments = transcript_override, []
            prediction = predict_audio_file(temporary_path, loaded=self.loaded_model)
            resampled_waveform = prediction.resampled_waveform.numpy()

            def predict_window(window: np.ndarray) -> dict[str, float]:
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
                    window_path = Path(handle.name)
                try:
                    sf.write(
                        window_path,
                        window,
                        DEFAULT_CONFIG.sample_rate,
                        subtype="PCM_16",
                    )
                    return predict_audio_file(
                        window_path,
                        loaded=self.loaded_model,
                    ).emotion_probabilities
                finally:
                    window_path.unlink(missing_ok=True)

            neural_probability_map, neural_window_count = infer_recording_probabilities(
                waveform=resampled_waveform,
                sample_rate=DEFAULT_CONFIG.sample_rate,
                window_samples=DEFAULT_CONFIG.target_samples,
                first_window_probabilities=prediction.emotion_probabilities,
                speech_segments=asr_segments,
                predict_window=predict_window,
            )
            neural_probabilities = np.array(
                [neural_probability_map[label] for label in EMOTION_LABELS],
                dtype=np.float32,
            )
            symbolic = self.reasoner.analyze(
                transcript,
                resampled_waveform,
                SAMPLE_RATE,
                neural_probabilities,
            )
            fusion = calculate_dynamic_fusion_weights(
                neural_probabilities,
                symbolic["context_scores"],
            )
            fused = (
                fusion["neural_weight"] * neural_probabilities
                + fusion["symbolic_weight"] * symbolic["symbolic_probabilities"]
            )
            fused = fused / max(float(fused.sum()), 1e-8)
            predicted_index = int(np.argmax(fused))
            duration_ms = float(prediction.audio.duration_seconds * 1000)

            cue_spans = []
            activated_rules = []
            score_adjustments = []
            for trace_index, trace in enumerate(symbolic["traces"]):
                if not trace.get("activated"):
                    continue
                category = str(trace["rule_category"])
                source = "acoustic" if category == "prosodic" else "linguistic"
                cue = str(trace.get("cue", trace["rule_id"]))
                if category != "agreement":
                    cue_spans.append(
                        {
                            "source": source,
                            "startMs": 0.0,
                            "endMs": duration_ms,
                            "cue": str(trace["rule_id"]),
                            "value": cue,
                        }
                    )
                rule_weight = RULE_WEIGHTS.get(category, 1.0)
                activated_rules.append(
                    {
                        "id": f"{trace['rule_id']}-{trace_index + 1}",
                        "description": RULE_DESCRIPTIONS.get(
                            category,
                            "A preliminary symbolic rule was activated.",
                        ) + f" Preliminary rule weight: {rule_weight:.2f}.",
                    }
                )
                targets = trace.get("target_emotion", [])
                if targets:
                    target = str(targets[0])
                    if target in CONTRACT_EMOTION:
                        score_adjustments.append(
                            {
                                "emotionClassification": to_contract_emotion(target),
                                "delta": float(
                                    trace.get("reported_adjustment", 0.0) * rule_weight
                                ),
                                "reason": (
                                    "The neural model and "
                                    f"{', '.join(trace.get('supporting_rules', [])) or 'active rule evidence'} "
                                    f"both support {target}; an agreement adjustment was added."
                                    if category == "agreement"
                                    else (
                                        f"{trace['rule_id']} detected {cue!r} and reported a "
                                        f"{trace.get('direction', 'support')} adjustment."
                                    )
                                ),
                            }
                        )

            if transcript_override is not None:
                cue_spans.append(
                    {
                        "source": "linguistic",
                        "startMs": 0.0,
                        "endMs": duration_ms,
                        "cue": "USER_REVIEWED_TRANSCRIPT",
                        "value": transcript or "No transcript",
                    }
                )
            elif asr_segments:
                cue_spans.append(
                    {
                        "source": "linguistic",
                        "startMs": float(asr_segments[0]["start"] * 1000),
                        "endMs": float(asr_segments[-1]["end"] * 1000),
                        "cue": "ASR_TRANSCRIPT",
                        "value": transcript or "No transcript",
                    }
                )

            before = probability_breakdown(neural_probabilities)
            after = probability_breakdown(fused)
            activated_names = ", ".join(rule["id"] for rule in activated_rules)
            transcript_description = (
                "User-reviewed transcript was used."
                if transcript_override is not None
                else f"Transcript generated by {ASR_MODEL_NAME}."
            )
            explanation = (
                f"{transcript_description} The fine-tuned neural model analyzed the full recording "
                f"in {neural_window_count} five-second window(s) and favored "
                f"{EMOTION_LABELS[int(np.argmax(neural_probabilities))]}; "
                f"the preliminary symbolic layer activated {activated_names or 'no rules'} "
                f"and produced the fused classification. Adaptive fusion assigned "
                f"{fusion['neural_weight']:.0%} weight to audio and "
                f"{fusion['symbolic_weight']:.0%} to symbolic evidence because "
                f"{fusion['reason']}."
            )
            return {
                "outcome": "definitive",
                "emotionClassification": to_contract_emotion(EMOTION_LABELS[predicted_index]),
                "confidence": after,
                "transcript": transcript,
                "explanation": explanation,
                "technicalTrace": {
                    "cueSpans": cue_spans,
                    "activatedRules": activated_rules,
                    "scoreAdjustments": score_adjustments,
                    "scoreJourney": symbolic["score_journey"],
                    "probabilities": {
                        "before": before,
                        "symbolic": probability_breakdown(symbolic["symbolic_probabilities"]),
                        "after": after,
                    },
                },
                "contractVersion": contract_version,
                "schemaVersion": "research-response-v2",
                "modelVersion": (
                    f"{MODEL_VERSION}+reviewed-transcript"
                    if transcript_override is not None
                    else f"{MODEL_VERSION}+asr-{ASR_MODEL_NAME}"
                ),
                "preprocessingVersion": "tsera-16khz-windowed-5s-logmel-delta-v2",
                "ruleSetVersion": "preliminary-five-tier-rules-v7-adaptive-fusion",
            }
        finally:
            temporary_path.unlink(missing_ok=True)


def json_response(handler: BaseHTTPRequestHandler, status: int, body: dict[str, Any]) -> None:
    encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(encoded)))
    handler.end_headers()
    handler.wfile.write(encoded)


class Handler(BaseHTTPRequestHandler):
    runtime: ResearchRuntime

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            json_response(
                self,
                HTTPStatus.OK,
                {"status": "ok", "service": "research-engine", "version": "0.1.0"},
            )
            return
        json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found", "message": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in {"/v1/analyze", "/v1/transcribe"}:
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found", "message": "Not found"})
            return
        try:
            content_length = int(self.headers.get("content-length", "0"))
            if content_length <= 0 or content_length > 32 * 1024 * 1024:
                raise ValueError("Request body is missing or too large")
            request = json.loads(self.rfile.read(content_length))
            encoded_audio = str(request["audioBase64"])
            audio_bytes = base64.b64decode(encoded_audio, validate=True)
            if not audio_bytes:
                raise ValueError("Audio payload is empty")

            if self.path == "/v1/transcribe":
                with self.runtime.lock:
                    transcript = self.runtime.transcribe_audio(audio_bytes)
                json_response(self, HTTPStatus.OK, {"transcript": transcript})
                return

            analysis_id = str(request["analysisId"])
            contract_version = str(request["contractVersion"])
            transcript_override = request.get("transcript")
            if transcript_override is not None and (
                not isinstance(transcript_override, str) or len(transcript_override) > 4000
            ):
                raise ValueError("Transcript must be a string of at most 4000 characters")
            with self.runtime.lock:
                result = self.runtime.analyze(
                    audio_bytes,
                    contract_version,
                    transcript_override,
                )
            json_response(self, HTTPStatus.OK, {"analysisId": analysis_id, "result": result})
        except (KeyError, ValueError, json.JSONDecodeError, binascii.Error) as error:
            json_response(
                self,
                HTTPStatus.BAD_REQUEST,
                {"error": "validation_error", "message": str(error)},
            )
        except Exception:
            json_response(
                self,
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {
                    "error": "research_engine_failure",
                    "message": "The model-backed Research System could not process the audio.",
                },
            )

    def log_message(self, _format: str, *_args: Any) -> None:
        return


def main() -> None:
    runtime = ResearchRuntime()
    Handler.runtime = runtime
    host = os.getenv("RESEARCH_ENGINE_HOST", "0.0.0.0")
    port = int(os.getenv("RESEARCH_ENGINE_PORT", "4100"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(
        "research-engine ready",
        f"model={MODEL_PATH}",
        f"asr={ASR_MODEL_NAME}",
        f"device={ASR_DEVICE}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
