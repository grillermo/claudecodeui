import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import type { Project } from '@/shared/types';
import WorkspaceStateView from '@/modules/project-workspace/WorkspaceStateView';
import { recordRecentProject } from '@/modules/project-workspace/utils/recentProjects';

const project = (projectId: string): Project => ({
  projectId,
  displayName: `Project ${projectId}`,
  fullPath: `/repo/${projectId}`,
  sessions: [],
});

beforeEach(() => {
  localStorage.clear();
});

test('the welcome screen lists recently opened projects and starts a new session on tap', () => {
  recordRecentProject('a');
  recordRecentProject('b');
  const onNewSession = vi.fn();
  const projects = [project('a'), project('b'), project('c')];

  render(
    <WorkspaceStateView mode="empty" isMobile={false} onMenuClick={() => {}} projects={projects} onNewSession={onNewSession} />,
  );

  const rows = screen.getAllByTestId('workspace-recent-project');
  assert.deepEqual(rows.map((row) => row.textContent?.startsWith('Project ') && row.textContent.slice(8, 9)), ['b', 'a']);
  assert.equal(screen.queryByTestId('workspace-welcome-tip'), null);

  fireEvent.click(rows[1]);
  assert.equal(onNewSession.mock.calls[0][0].projectId, 'a');
});

test('the welcome screen keeps the instructions when there is nothing recent', () => {
  render(<WorkspaceStateView mode="empty" isMobile={false} onMenuClick={() => {}} projects={[project('a')]} />);
  assert.ok(screen.getByTestId('workspace-welcome-tip'));
});
