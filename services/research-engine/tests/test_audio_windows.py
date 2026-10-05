import unittest

import numpy as np

from audio_windows import (
    aggregate_window_probabilities,
    audio_window_ranges,
    infer_recording_probabilities,
)


class AudioWindowTests(unittest.TestCase):
    def test_ranges_cover_full_recording_and_preserve_partial_tail(self):
        self.assertEqual(
            audio_window_ranges(sample_count=11, window_samples=4),
            [(0, 4), (4, 8), (8, 11)],
        )

    def test_recording_inference_scores_every_window_and_weights_partial_tail(self):
        predicted_windows = []

        def predict_window(window):
            predicted_windows.append(window.copy())
            if len(window) == 4:
                return {"angry": 0.0, "neutral": 1.0}
            return {"angry": 1.0, "neutral": 0.0}

        probabilities, window_count = infer_recording_probabilities(
            waveform=np.arange(11, dtype=np.float32),
            sample_rate=1,
            window_samples=4,
            first_window_probabilities={"angry": 1.0, "neutral": 0.0},
            speech_segments=[],
            predict_window=predict_window,
        )

        self.assertEqual(window_count, 3)
        self.assertEqual([len(window) for window in predicted_windows], [4, 3])
        self.assertAlmostEqual(probabilities["angry"], 7 / 11)
        self.assertAlmostEqual(probabilities["neutral"], 4 / 11)

    def test_speech_duration_increases_weight_without_dropping_other_windows(self):
        probabilities = aggregate_window_probabilities(
            window_probabilities=[
                {"angry": 1.0, "neutral": 0.0},
                {"angry": 0.0, "neutral": 1.0},
            ],
            window_ranges=[(0, 10), (10, 20)],
            sample_rate=1,
            speech_segments=[{"start": 10.0, "end": 20.0}],
        )

        self.assertAlmostEqual(probabilities["angry"], 1 / 3)
        self.assertAlmostEqual(probabilities["neutral"], 2 / 3)

    def test_overlapping_speech_segments_are_not_double_counted(self):
        probabilities = aggregate_window_probabilities(
            window_probabilities=[{"angry": 1.0}, {"angry": 1.0}],
            window_ranges=[(0, 10), (10, 20)],
            sample_rate=1,
            speech_segments=[
                {"start": 10.0, "end": 18.0},
                {"start": 15.0, "end": 20.0},
            ],
        )

        self.assertEqual(probabilities, {"angry": 1.0})


if __name__ == "__main__":
    unittest.main()
