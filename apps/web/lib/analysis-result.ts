import type { AnalysisLanguage, AnalysisOutcome, EmotionClassification } from '@damdai/contracts';

interface AnalysisLanguagePresentation {
  label: string;
  qualification: 'Research-validated' | 'Experimental';
  qualificationDescription: string;
}

interface AnalysisOutcomePresentation {
  label: string;
  description: string;
}

const languagePresentations: Record<AnalysisLanguage, AnalysisLanguagePresentation> = {
  taglish: {
    label: 'Taglish',
    qualification: 'Research-validated',
    qualificationDescription: 'Validated by the thesis research evidence.',
  },
  english: {
    label: 'English',
    qualification: 'Experimental',
    qualificationDescription: 'Separate research validation evidence is not yet available.',
  },
  tagalog: {
    label: 'Tagalog',
    qualification: 'Experimental',
    qualificationDescription: 'Separate research validation evidence is not yet available.',
  },
};

const outcomePresentations: Record<AnalysisOutcome, AnalysisOutcomePresentation> = {
  definitive: {
    label: 'Definitive Classification',
    description: 'The Research System returned a definitive classification of expressed speech.',
  },
  inconclusive: {
    label: 'Inconclusive Result',
    description:
      'The Research System did not return a sufficiently reliable classification for this speech sample.',
  },
};

const classificationLabels: Record<EmotionClassification, string> = {
  anger: 'Angry',
  happiness: 'Happy',
  neutrality: 'Neutral',
  sadness: 'Sad',
};

export function getAnalysisLanguagePresentation(
  language: AnalysisLanguage,
): AnalysisLanguagePresentation {
  return languagePresentations[language];
}

export function getAnalysisOutcomePresentation(
  outcome: AnalysisOutcome,
): AnalysisOutcomePresentation {
  return outcomePresentations[outcome];
}

export function formatClassification(classification: EmotionClassification): string {
  return classificationLabels[classification];
}

export function formatProbability(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

export function formatScoreDelta(delta: number): string {
  const percentage = Math.round(delta * 100);
  return `${percentage > 0 ? '+' : ''}${percentage}%`;
}
