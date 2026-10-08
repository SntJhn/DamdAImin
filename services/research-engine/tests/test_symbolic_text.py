import unittest

import numpy as np

from main import (
    SymbolicReasoner, build_score_adjustments, calculate_dynamic_fusion_weights, tokenize,
)


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

    def test_depress_spellings_contribute_sad_evidence_once(self):
        for term in (
            "depress", "de-depress", "dedepress", "na-depress", "nadepress",
            "nade-depress", "nadedepress", "nakaka-depress", "nakakadepress",
            "depressed", "depression", "depressing",
        ):
            with self.subTest(term=term):
                adjustments = [
                    item for item in build_score_adjustments(
                        self.analyze_text(f"Feel ko {term} ako.")["traces"]
                    )
                    if item["ruleId"] == "LEXICAL_EMOTION"
                ]
                self.assertEqual(len(adjustments), 1)
                self.assertEqual(adjustments[0]["cue"], term)
                self.assertEqual(adjustments[0]["emotionClassification"], "sadness")
                self.assertAlmostEqual(adjustments[0]["delta"], 0.30)

    def test_relationship_contrast_recognizes_de_depress_as_sad(self):
        result = self.analyze_text(
            "The thing is, I love him. I really do. Pero ang daming times na "
            "feel ko na de-depress ako kapag kasama ko siya."
        )
        lexical = next(
            trace for trace in result["traces"]
            if trace["rule_id"] == "LEXICAL_EMOTION" and trace["cue"] == "de-depress"
        )
        self.assertEqual(lexical["target_emotion"], ["sad"])
        self.assertGreater(lexical["score_contribution"]["sad"], 0)
        contrast = next(
            trace for trace in result["traces"]
            if trace["rule_id"] == "CONTRAST_POST_CLAUSE" and trace["cue"] == "pero"
        )
        self.assertGreater(contrast["score_contribution"]["sad"], 0)
        self.assertIn("de-depress", contrast["journey_cue"])

    def test_negation_is_exported_once_in_the_emotion_contribution(self):
        result = self.analyze_text("hindi masaya")
        adjustments = build_score_adjustments(result["traces"])
        lexical = [item for item in adjustments if item["ruleId"] == "LEXICAL_EMOTION"]
        self.assertEqual(len(lexical), 1)
        self.assertAlmostEqual(lexical[0]["delta"], -0.125)
        self.assertFalse(any(item["ruleId"] == "LEXICAL_NEGATION" for item in adjustments))

    def test_relationship_contrast_can_pull_fused_result_to_sad(self):
        neural = np.array([0.30, 0.41, 0.24, 0.05], dtype=np.float32)
        result = self.reasoner.analyze(
            "The thing is, I love him. I really do. Pero ang daming times na "
            "feel ko na de-depress ako kapag kasama ko siya.",
            waveform=np.full(160_000, 0.04, dtype=np.float32),
            sample_rate=16_000,
            neural_probabilities=neural,
        )
        self.assertEqual(int(np.argmax(result["symbolic_probabilities"])), 3)
        self.assertFalse(any(
            trace["rule_id"] == "NEURAL_RULE_AGREEMENT" for trace in result["traces"]
        ))
        weights = calculate_dynamic_fusion_weights(neural, result["context_scores"])
        fused = (
            weights["neural_weight"] * neural
            + weights["symbolic_weight"] * result["symbolic_probabilities"]
        )
        self.assertEqual(int(np.argmax(fused)), 3)

    def test_contrast_emphasizes_either_emotion_direction(self):
        for transcript, emotion in (
            ("masaya ako pero depressed ako", "sad"),
            ("depressed ako pero masaya ako", "happy"),
            ("masaya ako but depressed ako", "sad"),
        ):
            with self.subTest(transcript=transcript):
                result = self.analyze_text(transcript)
                lexical = [
                    trace for trace in result["traces"]
                    if trace["rule_id"] == "LEXICAL_EMOTION"
                ]
                contrast = next(
                    trace for trace in result["traces"]
                    if trace["rule_id"] == "CONTRAST_POST_CLAUSE"
                )
                # One extra lexical contribution doubles the post-clause evidence.
                self.assertAlmostEqual(
                    contrast["score_contribution"][emotion],
                    lexical[-1]["score_contribution"][emotion],
                )
                self.assertEqual(
                    int(np.argmax(result["symbolic_probabilities"])),
                    ("angry", "happy", "neutral", "sad").index(emotion),
                )

    def test_negated_post_contrast_cue_is_not_boosted_positively(self):
        result = self.analyze_text("masaya ako pero hindi depressed")
        contrast = next(
            trace for trace in result["traces"]
            if trace["rule_id"] == "CONTRAST_POST_CLAUSE"
        )
        self.assertLess(contrast["score_contribution"]["sad"], 0)

    def test_negation_does_not_cross_a_contrast_marker(self):
        result = self.analyze_text("hindi depressed pero masaya")
        happy = next(
            trace for trace in result["traces"]
            if trace["rule_id"] == "LEXICAL_EMOTION" and trace["cue"] == "masaya"
        )
        self.assertGreater(happy["score_contribution"]["happy"], 0)

    def test_contrast_scope_stops_at_sentence_boundaries(self):
        for boundary in (".", "!", "?", ";"):
            with self.subTest(boundary=boundary):
                result = self.analyze_text(f"masaya pero depressed{boundary} galit")
                contrast = next(
                    trace for trace in result["traces"]
                    if trace["rule_id"] == "CONTRAST_POST_CLAUSE"
                )
                self.assertNotIn("angry", contrast["score_contribution"])

    def test_later_contrast_can_restore_happy_agreement(self):
        result = self.analyze_text("masaya pero depressed pero masaya")
        agreement = next(
            trace for trace in result["traces"]
            if trace["rule_id"] == "NEURAL_RULE_AGREEMENT"
        )
        self.assertEqual(agreement["target_emotion"], ["happy"])

    def test_kapag_is_not_a_sad_shared_stem_cue(self):
        result = self.analyze_text("kapag kasama ko siya")
        self.assertFalse(any(
            trace["rule_id"] == "LEXICAL_EMOTION" and trace["cue"] == "kapag"
            for trace in result["traces"]
        ))

    def test_negated_post_contrast_happy_withholds_happy_agreement(self):
        result = self.analyze_text("masaya pero hindi masaya")
        self.assertFalse(any(
            trace["rule_id"] == "NEURAL_RULE_AGREEMENT" for trace in result["traces"]
        ))

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
