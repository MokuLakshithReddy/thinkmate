const on = (v?: string) => v === '1' || v === 'true';

export const flags = {
  stages: on(process.env.TM_STAGES ?? 'true'),
  evidence: on(process.env.TM_EVIDENCE ?? 'false'),
  research: on(process.env.TM_RESEARCH ?? 'false'),
  retrieval: (process.env.TM_RETRIEVAL as 'off' | 'fts' | 'vector') ?? 'off',
  teams: on(process.env.TM_TEAMS ?? 'false'),
};
