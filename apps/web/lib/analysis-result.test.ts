import { describe, expect, it } from 'vitest';

import {
  formatClassification,
  formatProbability,
  getAnalysisLanguagePresentation,
  getAnalysisOutcomePresentation,
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

  it.each([
    ['anger', 'Angry'],
    ['happiness', 'Happy'],
    ['neutrality', 'Neutral'],
    ['sadness', 'Sad'],
  ] as const)('uses the model-facing label %s as the user-facing %s label', (value, label) => {
    expect(formatClassification(value)).toBe(label);
  });
});
