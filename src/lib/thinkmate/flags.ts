const on = (v?: string) => v === '1' || v === 'true';

export const flags = {
  stages: on(process.env.TM_STAGES ?? 'true'),
  evidence: on(process.env.TM_EVIDENCE ?? 'true'),
  research: on(process.env.TM_RESEARCH ?? 'true'),
  retrieval: (process.env.TM_RETRIEVAL as 'off' | 'fts' | 'vector') ?? 'fts',
  teams: on(process.env.TM_TEAMS ?? 'true'),
};
