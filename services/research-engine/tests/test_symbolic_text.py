import unittest

import numpy as np

from main import SymbolicReasoner, tokenize


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

    def test_tokenization_preserves_masks_and_normal_word_boundaries(self):
        self.assertEqual(tokenize("a, a$$!"), ["a", "a$$"])
        self.assertEqual(tokenize("f*ck sh*t f@k"), ["f*ck", "sh*t", "f@k"])
        self.assertEqual(
            tokenize("I\u2019m HAPPY, Filipino-English; hello-world!"),
            ["i'm", "happy", "filipino-english", "hello-world"],
        )


if __name__ == "__main__":
    unittest.main()
