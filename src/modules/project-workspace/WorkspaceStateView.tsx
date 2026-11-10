import { useMemo } from 'react';
import { Folder, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';
import { readRecentProjectIds, selectRecentProjects } from '@/modules/project-workspace/utils/recentProjects';
import type { Project } from '@/shared/types';

type WorkspaceStateViewProps = {
  mode: 'loading' | 'empty';
  isMobile: boolean;
  onMenuClick: () => void;
  projects?: Project[];
  onNewSession?: (project: Project) => void;
};

const NO_PROJECTS: Project[] = [];
const noop = () => {};

/**
 * Rendered by WorkspaceMain instead of the workspace while projects load or when none is selected.
 * With no project selected it lists the last projects opened; tapping one starts a new session there.
 */
export default function WorkspaceStateView({
  mode,
  isMobile,
  onMenuClick,
  projects = NO_PROJECTS,
  onNewSession = noop,
}: WorkspaceStateViewProps) {
  const { t } = useTranslation();

  const isLoading = mode === 'loading';
  const recentProjects = useMemo(
    () => (isLoading ? NO_PROJECTS : selectRecentProjects(projects, readRecentProjectIds())),
    [isLoading, projects],
  );

  return (
    <div data-testid={isLoading ? 'workspace-loading' : 'workspace-welcome'} className="flex h-full flex-col">
      {isMobile && (
        <div data-testid="workspace-welcome-header" className="pwa-header-safe flex-shrink-0 border-b border-border/50 bg-background/80 p-2 backdrop-blur-sm sm:p-3">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-muted-foreground">
            <div className="mx-auto mb-4 h-10 w-10">
              <div
                data-testid="workspace-loading-spinner"
                className="h-full w-full rounded-full border-[3px] border-muted border-t-primary"
                style={{
                  animation: 'spin 1s linear infinite',
                  WebkitAnimation: 'spin 1s linear infinite',
                  MozAnimation: 'spin 1s linear infinite',
                }}
              />
            </div>
            <h2 data-testid="workspace-loading-title" className="mb-1 text-lg font-semibold text-foreground">{t('mainContent.loading')}</h2>
            <p data-testid="workspace-loading-description" className="text-sm">{t('mainContent.settingUpWorkspace')}</p>
          </div>
        </div>
      ) : (
        recentProjects.length > 0 ? (
          <div className="flex flex-1 items-center justify-center overflow-y-auto">
            <div className="mx-auto w-full max-w-md px-4 py-6">
              <h2 data-testid="workspace-welcome-title" className="mb-3 px-1 text-xl font-semibold text-foreground">{t('mainContent.recentProjects')}</h2>
              <ul data-testid="workspace-recent-projects" className="overflow-hidden rounded-xl border border-border/60 bg-card">
                {recentProjects.map((project) => (
                  <li key={project.projectId} className="border-b border-border/50 last:border-b-0">
                    <button
                      type="button"
                      data-testid="workspace-recent-project"
                      onClick={() => onNewSession(project)}
                      aria-label={t('mainContent.newSessionInProject', { name: project.displayName })}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/60 active:bg-muted"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted/60">
                        <Folder className="h-[18px] w-[18px] text-muted-foreground" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{project.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">{project.fullPath}</span>
                      </span>
                      <Plus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto max-w-md px-6 text-center">
            <div data-testid="workspace-welcome-icon" className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <Folder className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 data-testid="workspace-welcome-title" className="mb-2 text-xl font-semibold text-foreground">{t('mainContent.chooseProject')}</h2>
            <p data-testid="workspace-welcome-description" className="mb-5 text-sm leading-relaxed text-muted-foreground">{t('mainContent.selectProjectDescription')}</p>
            <div data-testid="workspace-welcome-tip" className="rounded-xl border border-primary/10 bg-primary/5 p-3.5">
              <p className="text-sm text-primary">
                <strong>{t('mainContent.tip')}:</strong> {isMobile ? t('mainContent.createProjectMobile') : t('mainContent.createProjectDesktop')}
              </p>
            </div>
          </div>
        </div>
        )
      )}
    </div>
  );
}
