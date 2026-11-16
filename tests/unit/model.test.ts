import { expect, it } from 'vitest';
import { latestByProject, type Scan } from '../../apps/desktop/src/types';
it('takes only the latest execution of each project without inventing resolution', () => {
  const scans = [
    { id: 'latest', config: { projectId: 'a' } },
    { id: 'older', config: { projectId: 'a' } },
    { id: 'other', config: { projectId: 'b' } },
  ] as Scan[];
  expect(latestByProject(scans).map((s) => s.id)).toEqual(['latest', 'other']);
});
