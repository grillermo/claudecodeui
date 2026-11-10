import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import type { Project } from '@/shared/types';
import {
  readRecentProjectIds,
  recordRecentProject,
  selectRecentProjects,
} from '@/modules/project-workspace/utils/recentProjects';

const project = (projectId: string, lastActivity?: string): Project => ({
  projectId,
  displayName: projectId,
  fullPath: `/repo/${projectId}`,
  sessions: lastActivity ? [{ id: `${projectId}-s`, lastActivity }] : [],
});

beforeEach(() => {
  localStorage.clear();
});

test('recordRecentProject keeps the most recent first without duplicates', () => {
  recordRecentProject('a');
  recordRecentProject('b');
  recordRecentProject('a');
  assert.deepEqual(readRecentProjectIds(), ['a', 'b']);
});

test('readRecentProjectIds survives corrupt storage', () => {
  localStorage.setItem('recentProjectIds', '{not json');
  assert.deepEqual(readRecentProjectIds(), []);
});

test('selectRecentProjects puts opened projects first, then tops up by session activity', () => {
  const projects = [
    project('old', '2026-01-01T00:00:00Z'),
    project('new', '2026-11-01T00:00:00Z'),
    project('opened'),
    project('idle'),
  ];
  const ids = selectRecentProjects(projects, ['gone', 'opened']).map((p) => p.projectId);
  assert.deepEqual(ids, ['opened', 'new', 'old']);
});

test('selectRecentProjects caps the list at the limit', () => {
  const projects = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => project(id));
  const ids = selectRecentProjects(projects, ['f', 'e', 'd', 'c', 'b', 'a']).map((p) => p.projectId);
  assert.deepEqual(ids, ['f', 'e', 'd', 'c', 'b']);
});
