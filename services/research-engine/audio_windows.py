"""Utilities for combining fixed-length neural predictions over an audio file."""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence

import numpy as np


def audio_window_ranges(sample_count: int, window_samples: int) -> list[tuple[int, int]]:
    """Return non-overlapping sample ranges that cover the entire recording."""
    if sample_count <= 0:
        raise ValueError("Audio must contain at least one sample.")
    if window_samples <= 0:
        raise ValueError("Inference windows must contain at least one sample.")

    return [
        (start, min(start + window_samples, sample_count))
        for start in range(0, sample_count, window_samples)
    ]


def _speech_overlap_seconds(
    start_seconds: float,
    end_seconds: float,
    segments: Sequence[Mapping[str, object]],
) -> float:
    intervals: list[tuple[float, float]] = []
    for segment in segments:
        try:
            start = float(segment["start"])
            end = float(segment["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            continue
        overlap_start = max(start_seconds, start)
        overlap_end = min(end_seconds, end)
        if overlap_end > overlap_start:
            intervals.append((overlap_start, overlap_end))

    if not intervals:
        return 0.0

    intervals.sort()
    merged_duration = 0.0
    merged_start, merged_end = intervals[0]
    for start, end in intervals[1:]:
        if start <= merged_end:
            merged_end = max(merged_end, end)
        else:
            merged_duration += merged_end - merged_start
            merged_start, merged_end = start, end
    merged_duration += merged_end - merged_start
    return merged_duration


def aggregate_window_probabilities(
    window_probabilities: Sequence[Mapping[str, float]],
    window_ranges: Sequence[tuple[int, int]],
    sample_rate: int,
    speech_segments: Sequence[Mapping[str, object]],
) -> dict[str, float]:
    """Average window distributions, giving speech-containing windows more weight.

    Each window receives weight equal to its valid duration plus the duration of
    ASR speech segments it contains. The duration term keeps every part of the
    recording represented when ASR misses speech or a reviewed transcript was
    supplied without timings.
    """
    if sample_rate <= 0:
        raise ValueError("Sample rate must be positive.")
    if not window_probabilities or len(window_probabilities) != len(window_ranges):
        raise ValueError("Each inference window must have one probability distribution.")

    labels = list(window_probabilities[0])
    if not labels:
        raise ValueError("Probability distributions must contain emotion labels.")

    totals = {label: 0.0 for label in labels}
    total_weight = 0.0
    for probabilities, (start_sample, end_sample) in zip(
        window_probabilities,
        window_ranges,
        strict=True,
    ):
        if set(probabilities) != set(labels):
            raise ValueError("All windows must use the same emotion labels.")
        if end_sample <= start_sample:
            raise ValueError("Inference windows must contain at least one sample.")

        duration = (end_sample - start_sample) / sample_rate
        start_seconds = start_sample / sample_rate
        end_seconds = end_sample / sample_rate
        speech_seconds = min(
            duration,
            _speech_overlap_seconds(start_seconds, end_seconds, speech_segments),
        )
        weight = duration + speech_seconds

        probability_total = sum(float(probabilities[label]) for label in labels)
        if not math.isfinite(probability_total) or probability_total <= 0:
            raise ValueError("Window probabilities must have a positive finite sum.")
        for label in labels:
            probability = float(probabilities[label])
            if not math.isfinite(probability) or probability < 0:
                raise ValueError("Window probabilities must be finite and non-negative.")
            totals[label] += weight * probability / probability_total
        total_weight += weight

    return {label: value / total_weight for label, value in totals.items()}


def infer_recording_probabilities(
    waveform: np.ndarray,
    sample_rate: int,
    window_samples: int,
    first_window_probabilities: Mapping[str, float],
    speech_segments: Sequence[Mapping[str, object]],
    predict_window: Callable[[np.ndarray], Mapping[str, float]],
) -> tuple[dict[str, float], int]:
    """Predict the remaining windows and return one recording-level distribution."""
    audio = np.asarray(waveform, dtype=np.float32)
    if audio.ndim != 1:
        raise ValueError("The resampled recording must be mono audio.")

    ranges = audio_window_ranges(int(audio.size), window_samples)
    probabilities = [first_window_probabilities]
    for start, end in ranges[1:]:
        probabilities.append(predict_window(audio[start:end]))

    return (
        aggregate_window_probabilities(probabilities, ranges, sample_rate, speech_segments),
        len(ranges),
    )
