import { describe, expect, it } from 'vitest';

import {
  describeLayerScores,
  describeScoreAdjustment,
  formatClassification,
  formatProbability,
  formatProbabilityDistribution,
  getAnalysisLanguagePresentation,
  getAnalysisOutcomePresentation,
  getLeadingClassifications,
} from './analysis-result.js';

describe('Analysis Record presentation', () => {
  it.each([
    ['taglish', 'Taglish', 'Research-validated'],
    ['english', 'English', 'Experimental'],
    ['tagalog', 'Tagalog', 'Experimental'],
  ] as const)('qualifies the %s Analysis Language honestly', (language, label, qualification) => {
    expect(getAnalysisLanguagePresentation(language)).toMatchObject({ label, qualification });
  });

  it('describes an Inconclusive Result without inventing a definitive classification', () => {
    expect(getAnalysisOutcomePresentation('inconclusive')).toEqual({
      label: 'Inconclusive Result',
      description:
        'The Research System did not return a sufficiently reliable classification for this speech sample.',
    });
  });

  it('formats returned probabilities for readable display', () => {
    expect(formatProbability(0.91)).toBe('91%');
    expect(formatProbability(0.035)).toBe('4%');
  });

  it('keeps rounded class percentages at 100 when individual rounding would total 101', () => {
    const percentages = formatProbabilityDistribution([0.1166667, 0.1166667, 0.1166666, 0.65]);
    expect(percentages.reduce((sum, percentage) => sum + Number.parseInt(percentage), 0)).toBe(100);
    expect(percentages[3]).toBe('65%');
  });

  it('describes an even split without inventing a leading emotion', () => {
    const scores = { happiness: 0.25, sadness: 0.25, anger: 0.25, neutrality: 0.25 };
    expect(getLeadingClassifications(scores)).toHaveLength(4);
    expect(describeLayerScores('The symbolic layer', scores)).toBe(
      'The symbolic layer gave all four emotions equal scores (25% each).',
    );
  });

  it('preserves a tie between the highest-scoring emotions', () => {
    const scores = { happiness: 0.4, sadness: 0.1, anger: 0.4, neutrality: 0.1 };
    expect(getLeadingClassifications(scores)).toEqual(['happiness', 'anger']);
    expect(describeLayerScores('The audio model', scores)).toBe(
      'The audio model tied Happy and Angry at 40%.',
    );
  });

  it.each([
    "PROSODIC_ENERGY_RATE detected 'energy and speaking rate' and reported a increase adjustment.",
    "CONTRADICTION_RECALIBRATION detected 'neural-symbolic disagreement' and reported a decrease adjustment.",
    "FUTURE_RULE detected 'an unfamiliar signal' and reported a increase adjustment.",
  ])('preserves a nonlexical adjustment reason: %s', (reason) => {
    expect(describeScoreAdjustment(reason, 'anger', 0.05)).toBe(reason);
  });

  it('describes only lexical adjustments as words', () => {
    expect(
      describeScoreAdjustment(
        "LEXICAL_EMOTION detected 'masaya' and reported a increase adjustment.",
        'happiness',
        0.15,
      ),
    ).toBe('The word or phrase “masaya” raised the Happy score.');
  });

  it('allows neural-rule agreement to be supported by an acoustic rule', () => {
    expect(
      describeScoreAdjustment(
        'The neural model and PROSODIC_ENERGY_RATE both support angry; an agreement adjustment was added.',
        'anger',
        0.7,
      ),
    ).toBe('The neural model and supporting rules agreed, which raised the Angry score.');
  });

  it.each([
    ['anger', 'Angry'],
    ['happiness', 'Happy'],
    ['neutrality', 'Neutral'],
    ['sadness', 'Sad'],
  ] as const)('uses the model-facing label %s as the user-facing %s label', (value, label) => {
    expect(formatClassification(value)).toBe(label);
  });
});
