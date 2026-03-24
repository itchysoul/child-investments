export interface LogicFinalTerm {
  id: string;
  name: string;
  keyword: string;
}

export const logicFinalTerms: LogicFinalTerm[] = [
  {
    id: 'begging-the-question',
    name: 'Petitio Principii / Begging the Question',
    keyword: 'assumes what needs to be proved',
  },
  {
    id: 'post-hoc',
    name: 'Post Hoc Ergo Propter Hoc',
    keyword: 'temporal precedence or correlation',
  },
  {
    id: 'affirming-the-consequent',
    name: 'Affirming the Consequent',
    keyword: 'If P, then Q. Q. Therefore P',
  },
  {
    id: 'denying-the-antecedent',
    name: 'Denying the Antecedent',
    keyword: 'If P, then Q. Not P. Therefore not Q',
  },
  {
    id: 'false-dichotomy',
    name: 'Bifurcation / False Dichotomy',
    keyword: 'limits choice',
  },
  {
    id: 'fallacy-of-compromise',
    name: 'Fallacy of Compromise',
    keyword: 'perfectly in between',
  },
  {
    id: 'naturalistic-fallacy',
    name: 'Naturalistic Fallacy / Is-Ought',
    keyword: 'existence or pleasantness',
  },
  {
    id: 'slippery-slope',
    name: 'Slippery Slope',
    keyword: 'treacherous step',
  },
  {
    id: 'false-analogy',
    name: 'False Analogy',
    keyword: 'Compares',
  },
  {
    id: 'hasty-generalization',
    name: 'Hasty Generalization',
    keyword: 'broad conclusion',
  },
  {
    id: 'sweeping-generalization',
    name: 'Sweeping Generalization',
    keyword: 'general rule absolutely',
  },
];

export const logicFinalTermCount = logicFinalTerms.length;
