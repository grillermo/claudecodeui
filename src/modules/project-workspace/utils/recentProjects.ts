import type { Project } from '@/shared/types';

const STORAGE_KEY = 'recentProjectIds';
export const RECENT_PROJECTS_LIMIT = 5;

/** Project ids the user opened on this device, most recent first. */
export const readRecentProjectIds = (): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

/** Moves `projectId` to the front of the recently opened list. */
export const recordRecentProject = (projectId: string): void => {
  const next = [projectId, ...readRecentProjectIds().filter((id) => id !== projectId)].slice(0, 20);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable
  }
};

const latestSessionActivity = (project: Project): number => {
  let latest = 0;
  for (const session of project.sessions ?? []) {
    const time = Date.parse(String(session.lastActivity || session.updated_at || session.createdAt || session.created_at || ''));
    if (!Number.isNaN(time) && time > latest) latest = time;
  }
  return latest;
};

/**
 * The projects to list on the welcome screen: the ones opened most recently on
 * this device, topped up with the projects that have the latest session activity
 * so a fresh install still shows something useful.
 */
export const selectRecentProjects = (
  projects: Project[],
  recentIds: string[],
  limit = RECENT_PROJECTS_LIMIT,
): Project[] => {
  const byId = new Map(projects.map((project) => [project.projectId, project]));
  const picked: Project[] = [];
  const seen = new Set<string>();

  for (const id of recentIds) {
    const project = byId.get(id);
    if (project && !seen.has(id)) {
      picked.push(project);
      seen.add(id);
    }
    if (picked.length >= limit) return picked;
  }

  const rest = projects
    .filter((project) => !seen.has(project.projectId))
    .map((project) => ({ project, activity: latestSessionActivity(project) }))
    .filter(({ activity }) => activity > 0)
    .sort((a, b) => b.activity - a.activity);

  for (const { project } of rest) {
    if (picked.length >= limit) break;
    picked.push(project);
  }

  return picked;
};
