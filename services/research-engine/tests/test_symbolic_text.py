import unittest

import numpy as np

from main import SymbolicReasoner, build_score_adjustments, tokenize


class SymbolicTextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reasoner = SymbolicReasoner()

    def profanity_cues(self, transcript):
        result = self.reasoner.analyze(
            transcript,
            waveform=np.zeros(16_000, dtype=np.float32),
            sample_rate=16_000,
            neural_probabilities=np.array([0.1, 0.7, 0.1, 0.1], dtype=np.float32),
        )
        return [
            trace["cue"]
            for trace in result["traces"]
            if trace["rule_id"] == "LEXICAL_PROFANITY"
        ]

    def test_childhood_transcript_does_not_trigger_profanity(self):
        transcript = (
            "Nakakita ko ng old arcade sa isang mall. Naglaro ako ng mga games "
            "na nilalaro ko nung bata ko and honestly, parang bumalik ako sa "
            "childhood for a while."
        )
        self.assertEqual(self.profanity_cues(transcript), [])

    def test_ordinary_a_is_not_a_masked_profanity(self):
        for transcript in ("a", "I waited for a while.", "It was a good day."):
            with self.subTest(transcript=transcript):
                self.assertEqual(self.profanity_cues(transcript), [])

    def test_actual_profanity_and_masked_spellings_still_match(self):
        for term in ("ass", "fuck", "a$$", "f*ck", "sh*t", "f@k", "p*tang ina", "b1tch"):
            with self.subTest(term=term):
                self.assertIn(term, self.profanity_cues(f"{term}!"))

    def analyze_text(self, transcript):
        return self.reasoner.analyze(
            transcript,
            waveform=np.zeros(16_000, dtype=np.float32),
            sample_rate=16_000,
            neural_probabilities=np.array([0.1, 0.7, 0.1, 0.1], dtype=np.float32),
        )

    def test_exported_evidence_preserves_split_targets(self):
        result = self.analyze_text("pagod")
        adjustments = [
            item for item in build_score_adjustments(result["traces"])
            if item["ruleId"] == "LEXICAL_EMOTION"
        ]
        self.assertEqual({item["emotionClassification"] for item in adjustments}, {"sadness", "neutrality"})
        for item in adjustments:
            self.assertEqual(item["cue"], "pagod")
            self.assertAlmostEqual(item["delta"], 0.075)
        self.assertEqual(result["score_journey"][-1]["scores"], {
            key: float(value) for key, value in zip(
                ("anger", "happiness", "neutrality", "sadness"),
                result["symbolic_probabilities"],
            )
        })

    def test_negation_is_exported_once_in_the_emotion_contribution(self):
        result = self.analyze_text("hindi masaya")
        adjustments = build_score_adjustments(result["traces"])
        lexical = [item for item in adjustments if item["ruleId"] == "LEXICAL_EMOTION"]
        self.assertEqual(len(lexical), 1)
        self.assertAlmostEqual(lexical[0]["delta"], -0.125)
        self.assertFalse(any(item["ruleId"] == "LEXICAL_NEGATION" for item in adjustments))

    def test_repeated_cues_keep_their_individual_signed_contributions(self):
        result = self.analyze_text("masaya ako pero hindi masaya ngayon")
        adjustments = [
            item for item in build_score_adjustments(result["traces"])
            if item["ruleId"] == "LEXICAL_EMOTION" and item["cue"] == "masaya"
        ]
        self.assertEqual(len(adjustments), 2)
        self.assertGreater(adjustments[0]["delta"], 0)
        self.assertLess(adjustments[1]["delta"], 0)

    def test_tokenization_preserves_masks_and_normal_word_boundaries(self):
        self.assertEqual(tokenize("a, a$$!"), ["a", "a$$"])
        self.assertEqual(tokenize("f*ck sh*t f@k"), ["f*ck", "sh*t", "f@k"])
        self.assertEqual(
            tokenize("I\u2019m HAPPY, Filipino-English; hello-world!"),
            ["i'm", "happy", "filipino-english", "hello-world"],
        )


if __name__ == "__main__":
    unittest.main()
